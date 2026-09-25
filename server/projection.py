"""Pure正文投影 for automation jobs; reading/ruby markup never enters engines."""
from __future__ import annotations
import xml.etree.ElementTree as ET
import re
from pathlib import Path

TTML = "http://www.w3.org/ns/ttml"
TTS = "http://www.w3.org/ns/ttml#styling"
TTM = "http://www.w3.org/ns/ttml#metadata"
RUBY = {"ruby", "rt", "rtc"}

def _content(value: str) -> str:
    return "" if not value.strip() and ("\n" in value or "\r" in value) else value

def _seconds(value: str | None) -> float | None:
    if not value:
        return None
    match = re.fullmatch(r"([0-9]+(?:\.[0-9]+)?)(ms|s)", value.strip())
    if match:
        return float(match.group(1)) / (1000 if match.group(2) == "ms" else 1)
    if re.fullmatch(r"[0-9]+(?:\.[0-9]+)?", value.strip()):
        return float(value)
    match = re.fullmatch(r"([0-9]+):([0-9]{2}):([0-9]{2}(?:\.[0-9]+)?)", value.strip())
    if match and int(match.group(2)) < 60 and float(match.group(3)) < 60:
        return float(match.group(1)) * 3600 + int(match.group(2)) * 60 + float(match.group(3))
    return None

def _timing(node: ET.Element, parent_begin: float, parent_end: float | None) -> tuple[float, float | None]:
    attrs = {(key.rsplit("}", 1)[-1] if key.startswith("{" + TTML + "}") else key): value for key, value in node.attrib.items()}
    null_value = node.attrib.get("{urn:lazulite:studio:draft}null", "")
    time_base = node.attrib.get("{http://www.w3.org/ns/ttml#parameter}timeBase", node.attrib.get("timeBase"))
    if time_base not in (None, "media") or attrs.get("timeContainer") == "seq" or null_value:
        raise ValueError("forced projection does not support seq/frame/tick/null timing")
    begin_raw, end_raw, dur_raw = attrs.get("begin"), attrs.get("end"), attrs.get("dur")
    begin = _seconds(begin_raw) if begin_raw is not None else 0.0
    end = _seconds(end_raw) if end_raw is not None else None
    dur = _seconds(dur_raw) if dur_raw is not None else None
    if (begin_raw is not None and begin is None) or (end_raw is not None and end is None) or (dur_raw is not None and dur is None):
        raise ValueError("forced projection has unsupported timing expression")
    # Reference-tool numeric clocks are absolute media seconds; unit-bearing
    # TTML expressions remain offsets from the parent.
    def position(raw: str | None, parsed: float | None) -> float | None:
        if parsed is None:
            return None
        return parsed if raw is not None and re.fullmatch(r"[0-9]+(?:\.[0-9]+)?", raw.strip()) else parent_begin + parsed
    absolute_begin = position(begin_raw, begin) if begin_raw is not None else parent_begin
    assert absolute_begin is not None
    candidates = [x for x in (parent_end, position(end_raw, end), absolute_begin + dur if dur is not None else None) if x is not None]
    absolute_end = min(candidates) if candidates else None
    if absolute_end is not None and absolute_end < absolute_begin:
        raise ValueError("forced projection timing is inverted")
    return absolute_begin, absolute_end

def _plain(node: ET.Element) -> str:
    local = node.tag.rsplit("}", 1)[-1]
    ruby_value = node.attrib.get("{" + TTS + "}ruby")
    if node.attrib.get("{" + TTM + "}role") in {"x-translation", "x-roman", "x-bg"}:
        return ""
    if local in RUBY or str(ruby_value).lower() in {"text", "textcontainer", "delimiter", "reading", "annotation"}:
        return ""
    if not (node.tag.startswith("{" + TTML + "}") and local in {"p", "span", "br"}):
        return ""
    value = "\n" if local == "br" else _content(node.text or "")
    return value + "".join(_plain(child) + _content(child.tail or "") for child in node)

def project_ttml(path: str | Path) -> list[dict[str, str]]:
    root = ET.parse(path).getroot()
    lines = []
    body = next((item for item in root if item.tag == "{" + TTML + "}body"), None)
    if body is None:
        return lines
    index = 0
    def visit(parent: ET.Element, path: list[int]):
        nonlocal index
        for child_index, element in enumerate(parent):
            if element.tag not in {"{" + TTML + "}div", "{" + TTML + "}p"}:
                continue
            local = element.tag.rsplit("}", 1)[-1]
            current_path = path + [child_index]
            if local == "p":
                xml_id = element.attrib.get("{http://www.w3.org/XML/1998/namespace}id")
                fallback = "line-" + "-".join(str(item) for item in current_path)
                lines.append({"id": xml_id or fallback, "text": _plain(element).strip()})
                index += 1
            else:
                visit(element, current_path)
    visit(body, [list(root).index(body)])
    return lines


def project_ttml_for_forced(path: str | Path, selected_line_id: str | None = None) -> list[dict[str, object]]:
    """Project confirmed lyric text and Ruby spans using Unicode code points.

    This deliberately shares the plain-text rules with ``project_ttml`` and
    never exposes annotation text as engine input.
    """
    root = ET.parse(path).getroot()
    body = next((item for item in root if item.tag == "{" + TTML + "}body"), None)
    if body is None:
        return []
    root_begin, root_end = _timing(root, 0.0, None)
    body_begin, body_end = _timing(body, root_begin, root_end)
    output: list[dict[str, object]] = []

    def visit(parent: ET.Element, path_parts: list[int], parent_begin: float, parent_end: float | None) -> None:
        for child_index, element in enumerate(parent):
            if element.tag not in {"{" + TTML + "}div", "{" + TTML + "}p"}:
                continue
            current_path = path_parts + [child_index]
            local = element.tag.rsplit("}", 1)[-1]
            if local == "div":
                try:
                    div_begin, div_end = _timing(element, parent_begin, parent_end)
                except ValueError:
                    ids = {child.attrib.get("{" + "http://www.w3.org/XML/1998/namespace" + "}id") for child in element.iter()}
                    if selected_line_id is not None and selected_line_id not in ids:
                        continue
                    raise
                visit(element, current_path, div_begin, div_end)
                continue
            line_id = element.attrib.get("{" + "http://www.w3.org/XML/1998/namespace" + "}id") or "line-" + "-".join(map(str, current_path))
            if selected_line_id is not None and line_id != selected_line_id:
                continue
            text_parts: list[str] = []
            spans: list[dict[str, object]] = []

            def append_text(value: str) -> None:
                if value:
                    text_parts.append(value)

            def walk(node: ET.Element) -> None:
                if not node.tag.startswith("{" + TTML + "}") or node.tag.rsplit("}", 1)[-1] not in {"p", "span", "br"}:
                    return
                local_name = node.tag.rsplit("}", 1)[-1]
                ruby = node.attrib.get("{" + TTS + "}ruby")
                if node.attrib.get("{" + TTM + "}role") in {"x-translation", "x-roman", "x-bg"}:
                    return
                if str(ruby).lower() in {"text", "textcontainer", "delimiter", "reading", "annotation"}:
                    return
                if str(ruby).lower() == "container":
                    base_node = next((x for x in node if x.attrib.get("{" + TTS + "}ruby") == "base"), None)
                    reading_node = next((x for x in node if x.attrib.get("{" + TTS + "}ruby") in {"text", "textContainer"}), None)
                    if base_node is not None and reading_node is not None:
                        start = len("".join(text_parts))
                        def ruby_text(value: ET.Element) -> str:
                            if not value.tag.startswith("{" + TTML + "}") or value.tag.rsplit("}", 1)[-1] != "span":
                                raise ValueError("unsupported Ruby child")
                            if any(not child.tag.startswith("{" + TTML + "}") or child.tag.rsplit("}", 1)[-1] != "span" for child in value.iter()):
                                raise ValueError("unsupported Ruby annotation subtree")
                            return "".join(_content(part) for part in value.itertext())
                        base = ruby_text(base_node)
                        reading = ruby_text(reading_node)
                        append_text(base)
                        spans.append({"ruby_id": f"{line_id}:ruby-{len(spans)}", "base_start": start, "base_end": start + len(base), "base": base, "reading": reading})
                    else:
                        raise ValueError("unsupported Ruby container: base and text are required")
                    return
                if local_name == "br":
                    append_text("\n")
                    return
                append_text(_content(node.text or ""))
                for child in node:
                    walk(child)
                    append_text(_content(child.tail or ""))

            walk(element)
            raw_text = "".join(text_parts)
            text = raw_text
            adjusted = []
            for span in spans:
                start, end = int(span["base_start"]), int(span["base_end"])
                adjusted.append({**span, "base_start": start, "base_end": end})
            begin_value, end_value = _timing(element, parent_begin, parent_end)
            output.append({"id": line_id, "text": text, "reading_spans": adjusted,
                           "begin": begin_value, "end": end_value, "timing_invalid": False})
    visit(body, [list(root).index(body)], body_begin, body_end)
    return output
