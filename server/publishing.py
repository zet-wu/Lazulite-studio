"""Small ISO BMFF publisher for one TTML ``stpp`` sample.

This deliberately supports the media shape Studio publishes: an existing MP4/M4A
is copied byte-for-byte and a subtitle track is added to a new ``moov``.  No
audio is decoded or re-encoded.  The module has no dependency on ffmpeg or a
database, which also makes its round-trip checks useful in the HTTP layer.
"""

from __future__ import annotations

import hashlib
import json
import shutil
import struct
import subprocess
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from pathlib import Path


class PublishingError(ValueError):
    pass


@dataclass(frozen=True)
class PublishReport:
    output: Path
    audio_codec: str | None
    audio_streams: int
    metadata_preserved: bool
    subtitle_handler: str
    subtitle_codec: str
    sample_count: int
    ttml_sha256: str
    audio_bytes_preserved: bool


def _box(kind: bytes, payload: bytes) -> bytes:
    size = 8 + len(payload)
    if size < 2**32:
        return struct.pack(">I4s", size, kind) + payload
    return struct.pack(">I4sQ", 1, kind, 16 + len(payload)) + payload


def _boxes(data: bytes):
    pos = 0
    while pos + 8 <= len(data):
        size, kind = struct.unpack_from(">I4s", data, pos)
        header = 8
        if size == 1:
            if pos + 16 > len(data):
                raise PublishingError("truncated extended box")
            size = struct.unpack_from(">Q", data, pos + 8)[0]
            header = 16
        elif size == 0:
            size = len(data) - pos
        if size < header or pos + size > len(data):
            raise PublishingError("invalid ISO BMFF box")
        yield kind, data[pos + header:pos + size], pos, size
        pos += size
    if pos != len(data):
        raise PublishingError("trailing bytes in ISO BMFF box list")


def _find(payload: bytes, kind: bytes) -> bytes | None:
    return next((body for typ, body, _, _ in _boxes(payload) if typ == kind), None)


def _fullbox(version: int, flags: int = 0) -> bytes:
    return bytes((version,)) + flags.to_bytes(3, "big")


def _track_id(moov: bytes) -> int:
    ids = []
    for typ, body, _, _ in _boxes(moov):
        if typ != b"trak":
            continue
        tkhd = _find(body, b"tkhd")
        if tkhd and len(tkhd) >= 16:
            ids.append(struct.unpack_from(">I", tkhd, 20 if tkhd[0] == 1 else 12)[0])
    return max(ids, default=0) + 1


def _stpp_track(sample_size: int, offset: int, track_id: int, duration_ms: int, movie_timescale: int) -> bytes:
    namespace = b"http://www.w3.org/ns/ttml\0"
    stpp_entry = _box(b"stpp", b"\0" * 6 + struct.pack(">H", 1) + namespace + b"\0\0")
    stsd = _box(b"stsd", _fullbox(0) + struct.pack(">I", 1) + stpp_entry)
    stts = _box(b"stts", _fullbox(0) + struct.pack(">I", 1) + struct.pack(">II", 1, duration_ms))
    stsc = _box(b"stsc", _fullbox(0) + struct.pack(">I", 1) + struct.pack(">III", 1, 1, 1))
    stsz = _box(b"stsz", _fullbox(0) + struct.pack(">II", 0, 1) + struct.pack(">I", sample_size))
    stco = _box(b"stco", _fullbox(0) + struct.pack(">II", 1, offset))
    stbl = _box(b"stbl", stsd + stts + stsc + stsz + stco)
    nmhd = _box(b"nmhd", _fullbox(0))
    dref = _box(b"dref", _fullbox(0) + struct.pack(">I", 1) + _box(b"url ", _fullbox(0, 1)))
    dinf = _box(b"dinf", dref)
    minf = _box(b"minf", nmhd + dinf + stbl)
    mdhd = _box(b"mdhd", _fullbox(0) + struct.pack(">IIIIH2s", 0, 0, 1000, duration_ms, 0x55C4, b"\0\0"))
    hdlr = _box(b"hdlr", _fullbox(0) + struct.pack(">I4sIII", 0, b"subt", 0, 0, 0) + b"Lazulite TTML\0")
    mdia = _box(b"mdia", mdhd + hdlr + minf)
    matrix = struct.pack(">9I", 0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000)
    tkhd = _box(b"tkhd", _fullbox(0, 7) + struct.pack(">IIIII", 0, 0, track_id, 0, round(duration_ms * movie_timescale / 1000)) + struct.pack(">IIhhHh", 0, 0, 0, 0, 0, 0) + matrix + struct.pack(">II", 0, 0))
    return _box(b"trak", tkhd + mdia)


def _probe(path: Path, ffprobe: str = "ffprobe") -> dict:
    try:
        result = subprocess.run([ffprobe, "-v", "error", "-of", "json", "-show_format", "-show_streams", str(path)], check=True, capture_output=True, text=True)
        return json.loads(result.stdout)
    except (OSError, subprocess.CalledProcessError, json.JSONDecodeError) as exc:
        raise PublishingError("ffprobe failed") from exc


def _scan_top(path: Path):
    """Yield top-level box headers without loading media payloads."""
    total = path.stat().st_size
    with path.open("rb") as source:
        pos = 0
        while pos < total:
            source.seek(pos)
            header = source.read(8)
            if len(header) != 8:
                raise PublishingError("truncated ISO BMFF header")
            size, kind = struct.unpack(">I4s", header)
            header_size = 8
            if size == 1:
                extra = source.read(8)
                if len(extra) != 8:
                    raise PublishingError("truncated extended box")
                size = struct.unpack(">Q", extra)[0]
                header_size = 16
            elif size == 0:
                raise PublishingError("top-level size-zero boxes are not supported")
            if size < header_size or pos + size > total:
                raise PublishingError("invalid ISO BMFF box")
            if kind in (b"moof", b"mfra"):
                raise PublishingError("fragmented MP4 is not supported")
            yield kind, pos, size, header_size
            pos += size


def _read_payload(path: Path, pos: int, size: int, header_size: int) -> bytes:
    with path.open("rb") as source:
        source.seek(pos + header_size)
        payload = source.read(size - header_size)
    if len(payload) != size - header_size:
        raise PublishingError("truncated ISO BMFF box")
    return payload


def _range_digest(path: Path, boxes) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for kind, pos, size, _ in boxes:
            if kind == b"free":
                continue
            source.seek(pos)
            remaining = size
            while remaining:
                block = source.read(min(1024 * 1024, remaining))
                if not block:
                    raise PublishingError("truncated media box")
                digest.update(block)
                remaining -= len(block)
    return digest.hexdigest()


def _movie_clock(moov: bytes) -> tuple[int, int]:
    mvhd = _find(moov, b"mvhd")
    if not mvhd:
        raise PublishingError("movie has no mvhd")
    if mvhd[0] == 1:
        return struct.unpack_from(">IQ", mvhd, 20)[0:2]
    return struct.unpack_from(">II", mvhd, 12)


def media_duration_us(path: Path) -> int:
    """Return the movie duration clock in microseconds for publish validation."""
    path = Path(path)
    item = next((item for item in _scan_top(path) if item[0] == b"moov"), None)
    if item is None:
        raise PublishingError("input has no moov box")
    timescale, duration = _movie_clock(_read_payload(path, item[1], item[2], item[3]))
    if timescale <= 0:
        raise PublishingError("movie has invalid timescale")
    return (duration * 1_000_000) // timescale


def stpp_tracks(source: Path) -> list[dict]:
    item = next((x for x in _scan_top(source) if x[0] == b"moov"), None)
    if item is None: raise PublishingError("input has no moov")
    return _tracks(_read_payload(source, *item[1:]))


def _tracks(moov):
    result = []
    for typ, trak, _, _ in _boxes(moov):
        if typ != b"trak": continue
        mdia = _find(trak, b"mdia") or b""
        stbl = _find(_find(mdia, b"minf") or b"", b"stbl") or b""
        stsd = _find(stbl, b"stsd") or b""
        if not stsd or not any(k == b"stpp" for k, *_ in _boxes(stsd[8:])): continue
        tkhd = _find(trak, b"tkhd")
        track_id = struct.unpack_from(">I", tkhd, 20 if tkhd[0] == 1 else 12)[0]
        mdhd, hdlr = _find(mdia, b"mdhd"), _find(mdia, b"hdlr")
        code = struct.unpack_from(">H", mdhd, 32 if mdhd[0] == 1 else 20)[0]
        language = ''.join(chr(((code >> shift) & 31) + 96) for shift in (10, 5, 0))
        result.append({"track_id": track_id, "language": language, "name": hdlr[24:].rstrip(b"\0").decode('utf-8', errors='replace') if hdlr else ''})
    return result


def _trak_id(trak):
    tkhd = _find(trak, b"tkhd")
    return struct.unpack_from(">I", tkhd, 20 if tkhd[0] == 1 else 12)[0]


def publish_stpp(source: Path, ttml: str | bytes, output: Path, *, ffprobe: str = "ffprobe", target_track_id: int | None = None) -> PublishReport:
    source, output = Path(source), Path(output)
    if not source.is_file():
        raise PublishingError("source media is missing")
    if source.stat().st_size > 500 * 1024 * 1024:
        raise PublishingError("media exceeds 500 MiB limit")
    sample = ttml.encode("utf-8") if isinstance(ttml, str) else bytes(ttml)
    if not sample.strip():
        raise PublishingError("TTML sample is empty")
    try:
        ET.fromstring(sample)
    except (ET.ParseError, ValueError) as exc:
        raise PublishingError("TTML is not well-formed XML") from exc
    before = _probe(source, ffprobe)
    top = list(_scan_top(source))
    moov_header = next((item for item in top if item[0] == b"moov"), None)
    if moov_header is None or sum(1 for item in top if item[0] == b"moov") != 1:
        raise PublishingError("input must contain exactly one moov")
    _, moov_pos, moov_size, moov_header_size = moov_header
    moov = _read_payload(source, moov_pos, moov_size, moov_header_size)
    movie_timescale, movie_duration = _movie_clock(moov)
    if _find(moov, b"mvex") is not None:
        raise PublishingError("fragmented MP4 is not supported")
    tracks = _tracks(moov)
    if tracks and target_track_id not in {t['track_id'] for t in tracks}:
        raise PublishingError("select an existing STPP track ID")
    if not tracks and target_track_id is not None:
        raise PublishingError("target STPP track no longer exists")
    # Keep every original top-level box and append the sample. Existing chunk
    # offsets remain valid because their media bytes are never moved.
    # The old moov is replaced by same-sized free space. Thus all original
    # chunk offsets and audio bytes stay at their original file positions.
    old_moov_raw_size = moov_size
    mdat_offset = source.stat().st_size + 8
    mdat = _box(b"mdat", sample)
    if movie_duration <= 0 or movie_timescale <= 0:
        raise PublishingError("media has no finite movie duration")
    track_duration = (movie_duration * 1000 + movie_timescale - 1) // movie_timescale
    track = _stpp_track(len(sample), mdat_offset, (target_track_id or _track_id(moov)), track_duration, movie_timescale)
    # Update mvhd next_track_ID while preserving all other metadata.
    mvhd = _find(moov, b"mvhd")
    next_id_offset = 108 if mvhd and mvhd[0] == 1 else 96
    updated_moov = bytearray(moov)
    for typ, body, pos, size in _boxes(moov):
        if typ == b"mvhd":
            body_start = pos + size - len(body)
            updated_moov[body_start + next_id_offset:body_start + next_id_offset + 4] = struct.pack(">I", _track_id(moov) + 1)
    if target_track_id is not None:
        updated_moov = bytearray(b''.join(_box(k, body) for k, body, _, _ in _boxes(bytes(updated_moov)) if not (k == b'trak' and _trak_id(body) == target_track_id)))
    new_moov = _box(b"moov", bytes(updated_moov) + track)
    replacement = _box(b"free", b"\0" * (old_moov_raw_size - 8))
    output.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, output)
    with output.open("r+b") as target:
        target.seek(moov_pos)
        target.write(replacement)
        target.seek(0, 2)
        target.write(mdat)
        target.write(new_moov)
    after = _probe(output, ffprobe)
    output_moov = next(item for item in _scan_top(output) if item[0] == b"moov")
    if _read_payload(output, output_moov[1], output_moov[2], output_moov[3]) != bytes(updated_moov) + track:
        raise PublishingError("output moov round-trip mismatch")
    audio_before = [s for s in before.get("streams", []) if s.get("codec_type") == "audio"]
    audio_after = [s for s in after.get("streams", []) if s.get("codec_type") == "audio"]
    metadata_before = (before.get("format") or {}).get("tags", {})
    metadata_after = (after.get("format") or {}).get("tags", {})
    if not audio_before:
        raise PublishingError("media has no audio track")
    if len(audio_before) != len(audio_after) or audio_before != audio_after:
        raise PublishingError("audio track changed during publish")
    if metadata_before != metadata_after:
        raise PublishingError("metadata changed during publish")
    embedded = extract_stpp(output, target_track_id or _track_id(moov))
    if embedded != sample:
        raise PublishingError("stpp round-trip sample mismatch")
    source_size = source.stat().st_size
    audio_preserved = _range_digest(source, [item for item in top if item[0] != b"moov"]) == _range_digest(output, [item for item in _scan_top(output) if item[1] < source_size and item[0] != b"free"])
    if not audio_preserved:
        raise PublishingError("original media bytes changed during publish")
    return PublishReport(output, audio_after[0].get("codec_name"), len(audio_after), True, "subt", "stpp", 1, hashlib.sha256(sample).hexdigest(), True)


def extract_stpp(path: Path, track_id: int | None = None) -> bytes:
    """Read the first single-sample ``subt``/``stpp`` track from *path*."""
    path = Path(path)
    top = list(_scan_top(path))
    moov_item = next((item for item in top if item[0] == b"moov"), None)
    if moov_item is None:
        raise PublishingError("input has no moov box")
    moov = _read_payload(path, moov_item[1], moov_item[2], moov_item[3])
    for typ, trak, _, _ in _boxes(moov):
        if typ != b"trak":
            continue
        if track_id is not None and _trak_id(trak) != track_id:
            continue
        mdia = _find(trak, b"mdia")
        if not mdia or (_find(mdia, b"hdlr") or b"")[8:12] != b"subt":
            continue
        minf = _find(mdia, b"minf")
        stbl = _find(minf or b"", b"stbl")
        stsd = _find(stbl or b"", b"stsd")
        if not stsd or len(stsd) < 8:
            continue
        entries = list(_boxes(stsd[8:]))
        if not any(entry_type == b"stpp" for entry_type, _, _, _ in entries):
            continue
        stsz, stco = _find(stbl, b"stsz"), _find(stbl, b"stco")
        if not stsz or not stco or struct.unpack_from(">I", stsz, 8)[0] != 1:
            continue
        size = struct.unpack_from(">I", stsz, 12)[0]
        offset = struct.unpack_from(">I", stco, 8)[0]
        with path.open("rb") as source:
            source.seek(offset)
            sample = source.read(size)
        if len(sample) != size:
            raise PublishingError("truncated stpp sample")
        return sample
    raise PublishingError("no subt/stpp track found")
