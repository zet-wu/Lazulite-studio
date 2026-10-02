"""Immutable revision validation and verified media packaging job boundary."""
from __future__ import annotations

import math
import shutil
import uuid
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any
from .projection import _plain
from .time_units import milliseconds, clock, serialize_ttml

TTML_NS = "http://www.w3.org/ns/ttml"
TTP_NS = "http://www.w3.org/ns/ttml#parameter"
STUDIO_NS = "urn:lazulite:studio:draft"


class PublishInvalid(ValueError):
    pass


class MediaPublisher:
    """Single container-writing boundary, injectable in the persistent job runner."""
    def publish(self, ttml: bytes | None, asset_path: Path, output: Path, lrc: str, target_track_id: int | None):
        from .packaging import package_media
        return package_media(asset_path, output, ttml, lrc, target_track_id)


def _time(value: str | None) -> float | None:
    if value is None:
        return None
    value = value.strip()
    try:
        if value.endswith("ms"):
            return float(value[:-2]) / 1000
        if value.endswith("s"):
            return float(value[:-1])
        if ':' not in value: return float(value)
        parts = value.split(":")
        if len(parts) == 2: return int(parts[0]) * 60 + float(parts[1])
        if len(parts) == 3:
            return int(parts[0]) * 3600 + int(parts[1]) * 60 + float(parts[2])
    except (TypeError, ValueError):
        return None
    return None


def validate_publish_ttml(path: str | Path, max_duration: float | None = None) -> dict[str, Any]:
    """Validate final-publish invariants; overlapping lines are intentional and allowed."""
    try:
        from .documents import validate_ttml
        raw = Path(path).read_text(encoding="utf-8")
        validate_ttml(raw)
        root = ET.parse(path).getroot()
    except (ET.ParseError, OSError, UnicodeError, ValueError) as exc:
        raise PublishInvalid("revision is not readable TTML") from exc
    for agent in root.iter("{http://www.w3.org/ns/ttml#metadata}agent"):
        if agent.get("type") not in {"person", "character", "group", "organization", "other"}:
            raise PublishInvalid(f"歌手 {agent.get('{http://www.w3.org/XML/1998/namespace}id')}：缺失或非法 type")
    lines = root.findall(".//{%s}p" % TTML_NS)
    if not lines:
        raise PublishInvalid("lyrics must contain at least one line")
    parent_times: dict[int, tuple[float | None, float | None]] = {}
    def collect(element, inherited=(None, None)):
        local_begin = _time(element.get("begin")) if element.get("begin") is not None else None
        local_end = _time(element.get("end")) if element.get("end") is not None else None
        offset = 0
        begin = offset + local_begin if local_begin is not None else inherited[0]
        end = offset + local_end if local_end is not None else inherited[1]
        parent_times[id(element)] = (begin, end)
        for child in list(element):
            collect(child, (begin, end))
    collect(root)
    for index, line in enumerate(lines):
        text = _plain(line).strip()
        if not text:
            raise PublishInvalid(f"line {index + 1} is empty")
        begin, end = parent_times[id(line)]
        if begin is None or end is None:
            raise PublishInvalid(f"line {index + 1} requires complete begin/end timing")
        if end <= begin:
            raise PublishInvalid(f"line {index + 1} has invalid timing")
        if max_duration is not None and milliseconds(end) > milliseconds(max_duration):
            raise PublishInvalid("lyrics exceed source audio duration")
    for element in root.iter():
        if element.attrib.get("timeContainer") not in (None, "par"):
            raise PublishInvalid("unsupported timeContainer")
        if "dur" in element.attrib and element.tag != f"{{{TTML_NS}}}body":
            raise PublishInvalid("unsupported TTML clock parameter")
        time_base = element.attrib.get(f"{{{TTP_NS}}}timeBase")
        if time_base not in (None, "media"):
            raise PublishInvalid("unsupported TTML clock parameter")
        unsupported_clock = {"frameRate", "frameRateMultiplier", "subFrameRate", "tickRate"}
        if any(key in {f"{{{TTP_NS}}}{name}" for name in unsupported_clock} for key in element.attrib):
            raise PublishInvalid("unsupported TTML clock parameter")
        if f"{{{STUDIO_NS}}}null" in element.attrib:
            if not (element.tag in (f"{{{TTML_NS}}}span", "{http://music.apple.com/lyric-ttml-internal}span")
                    and not list(element) and (element.text or '').isspace()
                    and set(element.get(f"{{{STUDIO_NS}}}null", '').split()) == {'begin', 'end'}
                    and element.get('begin') is None and element.get('end') is None):
                raise PublishInvalid("draft timing null is not publishable")
        begin, end = element.get("begin"), element.get("end")
        if begin is not None or end is not None:
            if begin is None or end is None:
                raise PublishInvalid("timed elements require complete begin/end timing")
            b, e = _time(begin), _time(end)
            if b is None or e is None or not math.isfinite(b) or not math.isfinite(e) or b < 0 or e < 0 or e < b:
                raise PublishInvalid("timing must be finite and non-negative")
    return {"passed": True, "line_count": len(lines)}


class PublishRunner:
    capability = "publish.stpp"

    def __init__(self, revisions, asset_path, output_root: str | Path, publisher=None):
        self.revisions, self.asset_path, self.output_root = revisions, asset_path, Path(output_root)
        self.publisher = publisher
        self.output_root.mkdir(parents=True, exist_ok=True)

    def available(self) -> bool:
        return (self.publisher is not None and callable(getattr(self.publisher, "publish", None))
                and shutil.which("ffprobe") is not None)

    def run(self, project_id: str, request: dict[str, Any]) -> dict[str, Any]:
        if not self.available():
            raise RuntimeError("STPP publisher is not configured")
        revision = request["revision"]
        _, _ = self.revisions.read(project_id, revision)
        with self.revisions.db.connect() as c:
            row = c.execute("SELECT ttml_path FROM revisions WHERE id=? AND project_id=?", (revision, project_id)).fetchone()
        if not row:
            raise PublishInvalid("revision not found")
        with self.revisions.db.connect() as c:
            bound = c.execute('SELECT p.source_asset_id,p.name,a.filename FROM projects p JOIN assets a ON a.id=p.source_asset_id WHERE p.id=?', (project_id,)).fetchone()
        if not bound or bound[0] != request['asset_id']: raise PublishInvalid('bound asset changed')
        source = Path(row[0])
        asset = Path(self.asset_path(project_id))
        from mutagen import File
        from mutagen.mp4 import MP4
        from .publishing import media_duration_ms
        media = File(asset)
        ttml = None
        if isinstance(media, MP4):
            validate_publish_ttml(source, media_duration_ms(asset) / 1_000)
            tree = ET.parse(source)
            root = tree.getroot()
            # Convert only validated, fully untimed whitespace spans to text in place.
            for parent in root.iter():
                previous = None
                for child in list(parent):
                    if child.get(f"{{{STUDIO_NS}}}null") is not None and (child.text or '').isspace() and not list(child):
                        text = (child.text or '') + (child.tail or '')
                        if previous is None: parent.text = (parent.text or '') + text
                        else: previous.tail = (previous.tail or '') + text
                        parent.remove(child)
                    else: previous = child
            for element in root.iter():
                for name in ('begin', 'end', 'dur'):
                    if element.get(name) is not None:
                        element.set(name, clock(milliseconds(_time(element.get(name)))))
                for key in list(element.attrib):
                    if key.startswith('{'+STUDIO_NS+'}'): del element.attrib[key]
            ttml = serialize_ttml(root).encode('utf-8')
        from .media_format import describe_media, download_filename
        format_info = describe_media(asset, media, bound[2])
        if format_info['extension'] is None: raise PublishInvalid('源文件格式不支持打包')
        output = self.output_root / f"{uuid.uuid4().hex}{format_info['extension']}"
        try:
            result = dict(self.publisher.publish(ttml, asset, output, request['lrc_text'], request.get('target_track_id')) or {})
            if not isinstance(result.get("report"), dict) or "passed" not in result["report"]:
                raise PublishInvalid("publisher did not return a complete report")
            if result["report"].get("passed") is not True:
                raise PublishInvalid("publisher report did not pass")
            result.update(format_info)
            result["filename"] = download_filename(bound[1], format_info["extension"])
            # The service owns the output path, including cleanup on failure/cancel.
            result["output_path"] = str(output)
        except Exception:
            output.unlink(missing_ok=True)
            raise
        result["binding"] = {"project_id": project_id, "revision": revision, "asset_id": request["asset_id"]}
        return result
