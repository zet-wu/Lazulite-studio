"""Immutable source files and shared, active-lifetime PCM and waveform resources."""

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
from ..process_supervisor import run as run_process
import tempfile
import threading
from dataclasses import dataclass, replace
from pathlib import Path
import numpy as np


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
    valid_frames: int | None = None


@dataclass
class Proxy:
    pcm: bytes
    rate: int
    channels: int
    source_start_ms: int
    decoded_frames: int
    peaks: list[np.ndarray] | None = None
    mime_type: str = "audio/wav"
    offset_ms: int = 0

    @property
    def duration_ms(self):
        return milliseconds(len(self.pcm) / (self.rate * self.channels * 2))

    @property
    def header(self):
        size = len(self.pcm)
        return struct.pack('<4sI4s4sIHHIIHH4sI', b'RIFF', size + 36, b'WAVE', b'fmt ',
                           16, 1, self.channels, self.rate, self.rate * self.channels * 2,
                           self.channels * 2, 16, b'data', size)

    @property
    def size(self):
        return 44 + len(self.pcm)

    def read(self, start, end):
        """Slice the virtual WAV without copying the full PCM into a container."""
        if start >= 44: return self.pcm[start - 44:end - 44]
        return self.header[start:min(end, 44)] + self.pcm[:max(0, end - 44)]


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
        result = run_process(cmd, check=True, capture_output=True, text=True)
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
        self._resources: dict[str, Proxy] = {}
        self.ffmpeg = ffmpeg
        self.ffprobe = ffprobe
        (self.root / "source").mkdir(parents=True, exist_ok=True)
        (self.root / "cache").mkdir(parents=True, exist_ok=True)

    def import_asset(self, temporary_path: Path, original_name: str | None = None, *, verified_sha256: str | None = None) -> Asset:
        """Import staged bytes; callers may supply the digest computed from the upload/archive stream."""
        source = Path(temporary_path)
        if not source.is_file():
            raise MediaError("uploaded media is missing")
        digest = verified_sha256 if verified_sha256 is not None else content_hash(source)
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

    def clear(self):
        with self._proxy_lock:
            self._resources.clear()

    def playback_proxy(self, asset: Asset) -> Proxy:
        with self._proxy_lock:
            if asset.content_hash not in self._resources:
                # Vocal products keep their native sample clock. Originals use
                # the established 48 kHz stereo playback clock.
                rate = asset.probe.sample_rate if asset.valid_frames is not None else 48000
                try:
                    result = run_process([self.ffmpeg, '-v', 'error', '-i', str(asset.path),
                        '-map', '0:a:0', '-vn', '-ac', '2', '-ar', str(rate),
                        '-f', 's16le', '-c:a', 'pcm_s16le', 'pipe:1'], check=True, capture_output=True)
                except (OSError, subprocess.CalledProcessError) as exc:
                    raise MediaError('playback decode failed') from exc
                pcm = result.stdout
                decoded_frames = len(pcm) // 4
                if asset.valid_frames is not None:
                    size = asset.valid_frames * 4
                    if len(pcm) < size: raise MediaError('vocal audio is shorter than its valid frame count')
                    pcm = pcm[:size]
                self._resources[asset.content_hash] = Proxy(pcm, rate, 2, asset.probe.start_ms, decoded_frames)
            return self._resources[asset.content_hash]

    def pcm_window(self, asset: Asset, *, start_ms: int, end_ms: int) -> tuple[bytes, int, int]:
        """Read at most 4.02 seconds, including FFT context."""
        if start_ms < 0 or end_ms <= start_ms or end_ms - start_ms > 4_020:
            raise MediaError('invalid PCM window')
        proxy = self.playback_proxy(asset)
        first = round(start_ms * proxy.rate / 1000) * proxy.channels * 2
        last = min(len(proxy.pcm), round(end_ms * proxy.rate / 1000) * proxy.channels * 2)
        if first >= last: raise MediaError('PCM window is outside the audio')
        return proxy.pcm[first:last], proxy.rate, proxy.channels

    def peaks(self, asset: Asset, *, level: int, start_ms: int, end_ms: int) -> PeakWindow:
        if level < 0 or level > 15 or end_ms <= start_ms:
            raise MediaError('invalid waveform window')
        bucket_ms = 10 * (2**level)
        start_ms = max(start_ms, 0)
        proxy = self.playback_proxy(asset)
        end_ms = min(end_ms, proxy.duration_ms)
        if end_ms <= start_ms:
            return PeakWindow(asset.content_hash, 'peaks-v1', start_ms, end_ms, bucket_ms, (), ())
        with self._proxy_lock:
            if proxy.peaks is None: proxy.peaks = self._build_peaks(proxy)
        aligned_start = (start_ms // bucket_ms) * bucket_ms
        aligned_end = math.ceil(end_ms / bucket_ms) * bucket_ms
        values = proxy.peaks[level][aligned_start // bucket_ms:aligned_end // bucket_ms]
        return PeakWindow(asset.content_hash, 'peaks-v1', aligned_start, aligned_end, bucket_ms,
                          tuple(values[:, 0].tolist()), tuple(values[:, 1].tolist()))

    @staticmethod
    def _build_peaks(proxy):
        samples = np.frombuffer(proxy.pcm, dtype='<i2')
        bucket = max(1, round(proxy.rate / 100)) * proxy.channels
        count = math.ceil(len(samples) / bucket)
        base = np.empty((count, 2), dtype=np.float32)
        for index in range(count):
            block = samples[index * bucket:(index + 1) * bucket]
            base[index] = (int(block.min()) / 32768, int(block.max()) / 32768)
        levels = [base]
        for _ in range(15):
            previous = levels[-1]
            paired = len(previous) // 2
            current = np.empty((math.ceil(len(previous) / 2), 2), dtype=np.float32)
            current[:paired, 0] = np.minimum(previous[:paired*2:2, 0], previous[1:paired*2:2, 0])
            current[:paired, 1] = np.maximum(previous[:paired*2:2, 1], previous[1:paired*2:2, 1])
            if len(previous) % 2: current[-1] = previous[-1]
            levels.append(current)
        return levels
