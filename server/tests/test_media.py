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
    assert asset.probe.start_us > 1_900_000
    assert proxy.mime_type == "audio/wav"
    assert proxy.offset_us == 0
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
    peaks = service.peaks(asset, level=0, start_us=345_000, end_us=365_000)

    assert peaks.asset_hash == asset.content_hash
    assert peaks.version == "peaks-v1"
    assert peaks.start_us == 340_000 and peaks.end_us == 370_000
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
        assert proxy.offset_us == 0
        assert proxy.duration_us is not None and proxy.duration_us > 450_000
