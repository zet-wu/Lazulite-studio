from __future__ import annotations

import subprocess
import struct
import wave
from pathlib import Path

from server.studio.media import MediaService


def _make_pulse_wav(path: Path) -> None:
    with wave.open(str(path), "wb") as output:
        output.setnchannels(1); output.setsampwidth(2); output.setframerate(48000)
        samples = [0] * (48000 // 2)
        samples[16000:16800] = [24000] * 800
        output.writeframes(struct.pack("<%dh" % len(samples), *samples))


def _make_nonzero_m4a(path: Path, codec: str = "aac") -> None:
    wav = path.with_suffix(".wav")
    _make_pulse_wav(wav)
    subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-itsoffset", "2", "-i", str(wav), "-c:a", codec, str(path)],
        check=True,
    )


def test_import_proxy_preserves_source_and_maps_nonzero_origin(tmp_path: Path) -> None:
    source = tmp_path / "sample.m4a"
    _make_nonzero_m4a(source)
    service = MediaService(tmp_path / "store")
    asset = service.import_asset(source)
    proxy = service.playback_proxy(asset)

    assert asset.path.exists()
    assert asset.probe.start_ms > 1900
    assert proxy.mime_type == "audio/wav"
    assert proxy.offset_ms == 0
    assert proxy.path.stat().st_size > 44
    with wave.open(str(proxy.path), "rb") as decoded:
        values = struct.unpack("<%dh" % (decoded.getnframes() * decoded.getnchannels()), decoded.readframes(decoded.getnframes()))
    peak_frame = max(range(len(values)), key=lambda index: abs(values[index])) // decoded.getnchannels()
    assert abs(peak_frame / decoded.getframerate() - 1 / 3) < 0.04


def test_peaks_are_windowed_and_versioned(tmp_path: Path) -> None:
    source = tmp_path / "sample.m4a"
    _make_nonzero_m4a(source)
    service = MediaService(tmp_path / "store")
    asset = service.import_asset(source)
    peaks = service.peaks(asset, level=0, start_ms=345, end_ms=365)

    assert peaks.asset_hash == asset.content_hash
    assert peaks.version == "peaks-v1"
    assert peaks.start_ms == 340 and peaks.end_ms == 370
    assert len(peaks.minimum) == 3
    assert max(peaks.maximum) > 0.2


def test_alac_mp4_proxy_has_same_studio_origin(tmp_path: Path) -> None:
    for filename, codec in (("sample.mp4", "alac"), ("ordinary.m4a", "aac")):
        source = tmp_path / filename
        wav = source.with_suffix(".wav")
        _make_pulse_wav(wav)
        subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", str(wav), "-c:a", codec, str(source)], check=True)
        service = MediaService(tmp_path / codec)
        asset = service.import_asset(source)
        proxy = service.playback_proxy(asset)
        assert proxy.offset_ms == 0
        assert proxy.duration_ms is not None and proxy.duration_ms > 450


def test_pcm_window_context_limit_and_exact_sample_coordinates(tmp_path: Path) -> None:
    import pytest
    from server.studio.media import MediaError

    source = tmp_path / "context.wav"
    with wave.open(str(source), "wb") as output:
        output.setnchannels(2); output.setsampwidth(2); output.setframerate(48000)
        output.writeframes(b"\x00\x00\x00\x00" * (48000 * 9 + 123))
    service = MediaService(tmp_path / "store")
    asset = service.import_asset(source)
    for first, last in [(0, 4000), (3994, 8006), (0, 4020)]:
        data, rate, channels = service.pcm_window(asset, start_ms=first, end_ms=last)
        assert rate == 48000 and channels == 2
        assert len(data) == (round(last * rate / 1e3) - round(first * rate / 1e3)) * 4
    with pytest.raises(MediaError):
        service.pcm_window(asset, start_ms=0, end_ms=4021)
    for frame in (1, 2, 255, 256, 191744, 192256):
        timestamp = round(frame * 1e3 / 48000)
        assert abs(timestamp * 48000 / 1e3 - frame) <= 24
    # A request past the real tail is clipped to the proxy sample count.
    data, _, _ = service.pcm_window(asset, start_ms=9000, end_ms=9500)
    assert len(data) == 123 * 4
    data, _, _ = service.pcm_window(asset, start_ms=0, end_ms=6)
    assert len(data) == 288 * 4
