"""Small, file-backed media primitives used by the Studio HTTP layer.

The original is immutable and content addressed.  Derived playback and waveform
files are disposable and carry the source clock origin in their metadata.
"""

from __future__ import annotations
from ..time_units import milliseconds

import hashlib
import json
import math
import mimetypes
import os
import shutil
import struct
import subprocess
import tempfile
import threading
import wave
from dataclasses import dataclass, replace
from pathlib import Path
from typing import BinaryIO


class MediaError(ValueError):
    pass


@dataclass(frozen=True)
class MediaProbe:
    duration_ms: int | None
    start_ms: int
    sample_rate: int | None
    channels: int | None
    codec: str | None
    container: str | None
    mime_type: str


@dataclass(frozen=True)
class Asset:
    asset_id: str
    content_hash: str
    path: Path
    original_name: str
    size: int
    probe: MediaProbe


@dataclass(frozen=True)
class Proxy:
    path: Path
    mime_type: str
    source_start_ms: int
    offset_ms: int
    duration_ms: int | None


@dataclass(frozen=True)
class PeakWindow:
    asset_hash: str
    version: str
    start_ms: int
    end_ms: int
    bucket_ms: int
    minimum: tuple[float, ...]
    maximum: tuple[float, ...]


def probe_media(path: Path, *, ffprobe: str = "ffprobe") -> MediaProbe:
    """Probe the first audio stream without decoding the whole input."""
    cmd = [ffprobe, "-v", "error", "-of", "json", "-show_format", "-show_streams", str(path)]
    try:
        result = subprocess.run(cmd, check=True, capture_output=True, text=True)
        data = json.loads(result.stdout)
    except (OSError, subprocess.CalledProcessError, json.JSONDecodeError) as exc:
        raise MediaError("media probe failed") from exc
    stream = next((s for s in data.get("streams", []) if s.get("codec_type") == "audio"), None)
    if stream is None:
        raise MediaError("media has no audio stream")

    def integer_time(value: object) -> int | None:
        try:
            return math.floor(float(value) * 1000 + 0.5) if value not in (None, "N/A") else None
        except (TypeError, ValueError, OverflowError):
            return None

    duration = integer_time(stream.get("duration")) or integer_time(data.get("format", {}).get("duration"))
    start = integer_time(stream.get("start_time"))
    if start is None:
        start = integer_time(data.get("format", {}).get("start_time")) or 0
    rate = stream.get("sample_rate")
    return MediaProbe(
        duration_ms=duration,
        start_ms=start,
        sample_rate=int(rate) if rate and str(rate).isdigit() else None,
        channels=int(stream["channels"]) if stream.get("channels") else None,
        codec=stream.get("codec_name"),
        container=(data.get("format") or {}).get("format_name"),
        mime_type=mimetypes.guess_type(path.name)[0] or "application/octet-stream",
    )


def content_hash(path: Path, *, chunk_size: int = 1024 * 1024) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while chunk := source.read(chunk_size):
            digest.update(chunk)
    return digest.hexdigest()


def _asset_path(root: Path, digest: str) -> Path:
    return root / "source" / "original"


class MediaService:
    def __init__(self, root: Path, *, ffmpeg: str = "ffmpeg", ffprobe: str = "ffprobe") -> None:
        self.root = Path(root)
        self._proxy_lock = threading.RLock()
        self._peaks_lock = threading.Lock()
        self.ffmpeg = ffmpeg
        self.ffprobe = ffprobe
        (self.root / "source").mkdir(parents=True, exist_ok=True)
        (self.root / "cache").mkdir(parents=True, exist_ok=True)

    def import_asset(self, temporary_path: Path, original_name: str | None = None) -> Asset:
        source = Path(temporary_path)
        if not source.is_file():
            raise MediaError("uploaded media is missing")
        digest = content_hash(source)
        name = original_name or source.name
        probe = probe_media(source, ffprobe=self.ffprobe)
        destination = _asset_path(self.root, digest)
        destination.parent.mkdir(parents=True, exist_ok=True)
        if not destination.exists():
            fd, temporary_name = tempfile.mkstemp(prefix=f".{digest}.upload-", dir=destination.parent)
            os.close(fd)
            temporary = Path(temporary_name)
            try:
                shutil.copyfile(source, temporary)
                os.replace(temporary, destination)
            finally:
                temporary.unlink(missing_ok=True)
        probe = replace(probe, mime_type=mimetypes.guess_type(name)[0] or probe.mime_type)
        return Asset(digest, digest, destination, name, destination.stat().st_size, probe)

    def playback_proxy(self, asset: Asset) -> Proxy:
        with self._proxy_lock:
            return self._playback_proxy(asset)

    def _playback_proxy(self, asset: Asset) -> Proxy:
        """Create a normalized PCM WAV; Studio time starts at decoded sample zero."""
        target = self.root / "cache" / f"{asset.content_hash}.wav"
        if not target.exists():
            fd, temporary_name = tempfile.mkstemp(prefix="proxy-", suffix=".wav", dir=self.root / "cache")
            os.close(fd)
            temporary = Path(temporary_name)
            try:
                subprocess.run(
                    [self.ffmpeg, "-y", "-v", "error", "-i", str(asset.path), "-map", "0:a:0", "-vn", "-ac", "2", "-ar", "48000", "-c:a", "pcm_s16le", str(temporary)],
                    check=True,
                    capture_output=True,
                )
                os.replace(temporary, target)
            except (OSError, subprocess.CalledProcessError) as exc:
                temporary.unlink(missing_ok=True)
                raise MediaError("playback proxy generation failed") from exc
        # Studio time starts at the first decoded sample, including source
        # silence and codec priming. The original container PTS is diagnostic.
        with wave.open(str(target), "rb") as audio:
            duration_ms = milliseconds(audio.getnframes() / audio.getframerate())
        return Proxy(target, "audio/wav", asset.probe.start_ms, 0, duration_ms)

    def pcm_window(self, asset: Asset, *, start_ms: int, end_ms: int) -> tuple[bytes, int, int]:
        """Read at most 4.02 seconds from the PCM proxy, including FFT context."""
        if start_ms < 0 or end_ms <= start_ms or end_ms - start_ms > 4_020:
            raise MediaError("invalid PCM window")
        proxy = self.playback_proxy(asset)
        with wave.open(str(proxy.path), "rb") as audio:
            rate = audio.getframerate()
            first = round(start_ms * rate / 1_000)
            last = min(audio.getnframes(), round(end_ms * rate / 1_000))
            if first >= last:
                raise MediaError("PCM window is outside the audio")
            audio.setpos(first)
            return audio.readframes(last - first), rate, audio.getnchannels()

    def peaks(self, asset: Asset, *, level: int, start_ms: int, end_ms: int) -> PeakWindow:
        if level < 0 or level > 15 or end_ms <= start_ms:
            raise MediaError("invalid waveform window")
        bucket_ms = 10 * (2**level)
        start_ms = max(start_ms, 0)
        duration = self.playback_proxy(asset).duration_ms
        end_ms = min(end_ms, duration) if duration is not None else end_ms
        if end_ms <= start_ms:
            return PeakWindow(asset.content_hash, "peaks-v1", start_ms, end_ms, bucket_ms, (), ())
        self._ensure_peak_files(asset)
        path = self.root / "cache" / f"{asset.content_hash}.peaks-v1" / f"l{level}.peaks"
        aligned_start = (start_ms // bucket_ms) * bucket_ms
        aligned_end = math.ceil(end_ms / bucket_ms) * bucket_ms
        count = (aligned_end - aligned_start) // bucket_ms
        minimum: list[float] = []
        maximum: list[float] = []
        with path.open("rb") as source:
            source.seek((aligned_start // bucket_ms) * 8)
            for _ in range(count):
                record = source.read(8)
                if len(record) != 8:
                    minimum.append(0.0); maximum.append(0.0)
                else:
                    low, high = struct.unpack("<ff", record)
                    minimum.append(low); maximum.append(high)
        return PeakWindow(asset.content_hash, "peaks-v1", aligned_start, aligned_end, bucket_ms, tuple(minimum), tuple(maximum))

    def _ensure_peak_files(self, asset: Asset) -> None:
        with self._peaks_lock:
            self._build_peak_files(asset)

    def _build_peak_files(self, asset: Asset) -> None:
        target = self.root / "cache" / f"{asset.content_hash}.peaks-v1"
        if target.is_dir():
            return
        proxy = self.playback_proxy(asset)
        handles: list[BinaryIO] = []
        temporary_root = Path(tempfile.mkdtemp(prefix=f".{asset.content_hash}.peaks-", dir=self.root / "cache"))
        pending: list[tuple[float, float] | None] = [None] * 16
        try:
            with wave.open(str(proxy.path), "rb") as audio:
                frame_rate = audio.getframerate()
                bucket_frames = max(1, round(frame_rate / 100))
                for level in range(16):
                    path = temporary_root / f"l{level}.peaks"
                    handles.append(path.open("wb"))
                while block := audio.readframes(bucket_frames):
                    samples = struct.unpack("<%dh" % (len(block) // 2), block)
                    low, high = min(samples, default=0) / 32768, max(samples, default=0) / 32768
                    current = (low, high)
                    handles[0].write(struct.pack("<ff", *current))
                    for level in range(1, 16):
                        previous = pending[level]
                        if previous is None:
                            pending[level] = current
                            break
                        current = (min(previous[0], current[0]), max(previous[1], current[1]))
                        handles[level].write(struct.pack("<ff", *current))
                        pending[level] = None
                for level in range(1, 16):
                    if pending[level] is not None:
                        current = pending[level]
                        handles[level].write(struct.pack("<ff", *current))
                        pending[level] = None
                        for upper in range(level + 1, 16):
                            previous = pending[upper]
                            if previous is None:
                                pending[upper] = current
                                break
                            current = (min(previous[0], current[0]), max(previous[1], current[1]))
                            handles[upper].write(struct.pack("<ff", *current))
                            pending[upper] = None
        except Exception:
            shutil.rmtree(temporary_root, ignore_errors=True)
            raise
        finally:
            for handle in handles:
                handle.close()
        try:
            os.replace(temporary_root, target)
        except OSError:
            shutil.rmtree(temporary_root, ignore_errors=True)
