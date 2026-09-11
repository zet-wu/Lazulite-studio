"""Pure正文投影 for automation jobs; reading/ruby markup never enters engines."""
from __future__ import annotations
import xml.etree.ElementTree as ET
from pathlib import Path

TTML = "http://www.w3.org/ns/ttml"
TTS = "http://www.w3.org/ns/ttml#styling"
RUBY = {"ruby", "rt", "rtc"}

def _plain(node: ET.Element) -> str:
    local = node.tag.rsplit("}", 1)[-1]
    ruby_value = node.attrib.get("{" + TTS + "}ruby")
    if local in RUBY or str(ruby_value).lower() in {"text", "textcontainer", "delimiter", "reading", "annotation"}:
        return ""
    if not (node.tag.startswith("{" + TTML + "}") and local in {"p", "span", "br"}):
        return ""
    value = "\n" if local == "br" else (node.text or "")
    return value + "".join(_plain(child) + (child.tail or "") for child in node)

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
