"""S7 publication boundary.

The muxer is injected so the HTTP/job layer does not know about STPP details.
"""
from __future__ import annotations

import math
import shutil
import uuid
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any
from .projection import _plain, _timing

TTML_NS = "http://www.w3.org/ns/ttml"


class PublishInvalid(ValueError):
    pass


class StppPublisher:
    """Adapter around the low-level muxer supplied by ``server.publishing``."""
    def publish(self, revision_path: Path, asset_path: Path, output: Path) -> dict[str, Any]:
        from .publishing import publish_stpp
        report = publish_stpp(asset_path, Path(revision_path).read_bytes(), output)
        passed = (report.audio_streams > 0 and report.audio_bytes_preserved and report.metadata_preserved and
                  report.subtitle_handler == "subt" and report.subtitle_codec == "stpp" and
                  report.sample_count == 1 and output.is_file())
        return {"report": {"passed": passed, "audio_streams": report.audio_streams,
                            "audio_preserved": report.audio_bytes_preserved,
                            "metadata_preserved": report.metadata_preserved,
                            "subtitle_handler": report.subtitle_handler,
                            "subtitle_codec": report.subtitle_codec,
                            "sample_count": report.sample_count,
                            "ttml_sha256": report.ttml_sha256}}


def _time(value: str | None) -> float | None:
    if value is None:
        return None
    value = value.strip()
    try:
        if value.endswith("ms"):
            return float(value[:-2]) / 1000
        if value.endswith("s"):
            return float(value[:-1])
        parts = value.split(":")
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
    lines = root.findall(".//{%s}p" % TTML_NS)
    if not lines:
        raise PublishInvalid("lyrics must contain at least one line")
    parent_times: dict[int, tuple[float | None, float | None]] = {}
    def collect(element, inherited=(None, None)):
        local_begin = _time(element.get("begin")) if element.get("begin") is not None else None
        local_end = _time(element.get("end")) if element.get("end") is not None else None
        offset = inherited[0] or 0
        begin = offset + local_begin if local_begin is not None else inherited[0]
        end = offset + local_end if local_end is not None else inherited[1]
        if inherited[1] is not None and ((begin is not None and begin > inherited[1]) or (end is not None and end > inherited[1])):
            raise PublishInvalid("child timing exceeds parent interval")
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
        if max_duration is not None and end > max_duration + 1e-6:
            raise PublishInvalid("lyrics exceed source audio duration")
    for element in root.iter():
        if any(key.rsplit("}", 1)[-1] == "timeContainer" for key in element.attrib):
            raise PublishInvalid("unsupported timeContainer")
        if any(key.rsplit("}", 1)[-1].lower().endswith("null") for key in element.attrib):
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
        source = Path(row[0])
        asset = Path(self.asset_path(project_id))
        from .publishing import media_duration_us
        report = validate_publish_ttml(source, media_duration_us(asset) / 1_000_000)
        output = self.output_root / f"{uuid.uuid4().hex}{asset.suffix or '.mp4'}"
        result = self.publisher.publish(source, asset, output)
        result = dict(result or {})
        # Keep output ownership in the service; a publisher result cannot
        # redirect downloads to an arbitrary path.
        result["output_path"] = str(output)
        if not isinstance(result.get("report"), dict) or "passed" not in result["report"]:
            raise PublishInvalid("publisher did not return a complete report")
        if result["report"].get("passed") is not True:
            raise PublishInvalid("publisher report did not pass")
        result["binding"] = {"project_id": project_id, "revision": revision, "asset_id": request["asset_id"]}
        return result
