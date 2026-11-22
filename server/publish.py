"""Immutable revision validation and verified media packaging job boundary."""
from __future__ import annotations

import math
import unicodedata
import xml.etree.ElementTree as ET
from pathlib import Path
from .time_units import milliseconds, clock, serialize_ttml, try_parse_media_seconds

TTML_NS = "http://www.w3.org/ns/ttml"
TTP_NS = "http://www.w3.org/ns/ttml#parameter"
STUDIO_NS = "urn:lazulite:studio:draft"


class PublishInvalid(ValueError):
    pass


class MediaPublisher:
    """Single container-writing boundary for direct streaming packaging."""
    def publish(self, ttml: bytes | None, asset_path: Path, output: Path, lrc: str | None, target_track_id: int | None):
        from .packaging import package_media
        return package_media(asset_path, output, ttml, lrc, target_track_id)


def _untimed_space(node, *, body=False):
    text = node.text or ''
    return bool(text) and not list(node) and node.get('begin') is None and node.get('end') is None and all(
        unicodedata.category(char) == 'Zs' or body and char in '\t\r\n\u2028\u2029\ufeff' for char in text)


def validate_output_ttml(path: str | Path, *, xml: bool = False) -> ET.Element:
    """Validate ordinary TTML output, returning the parsed root element."""
    try:
        from .documents import validate_ttml
        raw = str(path) if xml else Path(path).read_text(encoding="utf-8")
        root = validate_ttml(raw)
    except (ET.ParseError, OSError, UnicodeError, ValueError) as exc:
        raise PublishInvalid("revision is not readable TTML") from exc
    for agent in root.iter("{http://www.w3.org/ns/ttml#metadata}agent"):
        if agent.get("type") not in {"person", "character", "group", "organization", "other"}:
            raise PublishInvalid(f"歌手 {agent.get('{http://www.w3.org/XML/1998/namespace}id')}：缺失或非法 type")
    # Translation drafts never borrow body timing or become plain text on publication.
    for translation in root.iter():
        if translation.tag.rsplit('}', 1)[-1] not in {'translation', 'transliteration'}:
            continue
        if translation.tag.rsplit('}', 1)[-1] == 'translation' and translation.get('type', 'subtitle') not in {'subtitle', 'replacement'}:
            raise PublishInvalid('unsupported translation type')
        for content in translation.iter():
            if content.tag.rsplit('}', 1)[-1] not in {'text', 'span'}:
                continue
            is_background = content.get('{http://www.w3.org/ns/ttml#metadata}role') == 'x-bg'
            if content.tag.rsplit('}', 1)[-1] == 'span' and not is_background:
                if _untimed_space(content):
                    continue
                if list(content) or content.get('begin') is None or content.get('end') is None or content.get(f'{{{STUDIO_NS}}}null'):
                    raise PublishInvalid('translation unit requires complete timing')
            if content.get(f'{{{STUDIO_NS}}}kind') == 'timed' and not list(content):
                raise PublishInvalid('timed translation has no units')
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
        begin, end = element.get("begin"), element.get("end")
        begin_s = try_parse_media_seconds(begin) if begin is not None else None
        end_s = try_parse_media_seconds(end) if end is not None else None
        if (begin is not None and (begin_s is None or not math.isfinite(begin_s) or begin_s < 0)) or (
            end is not None and (end_s is None or not math.isfinite(end_s) or end_s < 0)
        ):
            raise PublishInvalid("timing must be finite and non-negative")
        if begin_s is not None and end_s is not None and end_s < begin_s:
            raise PublishInvalid("end timing precedes begin")
    return root


def serialize_output_ttml(snapshot: dict) -> bytes:
    """Output copy with the same optional endpoints and whitespace as ordinary TTML."""
    root = validate_output_ttml(snapshot['lyrics']['draftTtml'], xml=True)
    ttm = '{http://www.w3.org/ns/ttml#metadata}'
    tts = '{http://www.w3.org/ns/ttml#styling}'
    sidecar_units = set()
    for track in root.iter():
        if track.tag.rsplit('}', 1)[-1] in {'translation', 'transliteration'}:
            for content in track.iter():
                units = [node for node in content if node.tag.rsplit('}', 1)[-1] == 'span' and node.get(ttm+'role') != 'x-bg']
                if any(not _untimed_space(unit) for unit in units):
                    sidecar_units.update(unit for unit in units if _untimed_space(unit))
    for parent in root.iter():
        previous = None
        body = parent.tag == f'{{{TTML_NS}}}p' or parent.tag == f'{{{TTML_NS}}}span' and parent.get(ttm+'role') == 'x-bg'
        for child in list(parent):
            body_space = (body and child.tag == f'{{{TTML_NS}}}span' and _untimed_space(child, body=True)
                          and child.get(ttm+'agent') is None and child.get(tts+'ruby') is None
                          and child.get('{http://www.example.com/ns/amll}obscene') != 'true'
                          and 'expletive' not in child.get(ttm+'role', '').split()
                          and child.get(f'{{{STUDIO_NS}}}id') not in snapshot['editing']['emptyBeats'])
            if body_space or child in sidecar_units:
                text = (child.text or '') + (child.tail or '')
                if previous is None: parent.text = (parent.text or '') + text
                else: previous.tail = (previous.tail or '') + text
                parent.remove(child)
            else: previous = child
    for element in root.iter():
        for name in ('begin', 'end', 'dur'):
            if element.get(name) is not None:
                element.set(name, clock(milliseconds(try_parse_media_seconds(element.get(name)))))
        for key in list(element.attrib):
            if key.startswith('{'+STUDIO_NS+'}'): del element.attrib[key]
    return serialize_ttml(root).encode('utf-8')
