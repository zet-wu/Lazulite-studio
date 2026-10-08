"""Plain TTML text extraction used by publication."""
from __future__ import annotations
import xml.etree.ElementTree as ET

TTML = "http://www.w3.org/ns/ttml"
TTS = "http://www.w3.org/ns/ttml#styling"
TTM = "http://www.w3.org/ns/ttml#metadata"
RUBY = {"ruby", "rt", "rtc"}

def _content(value: str) -> str:
    return "" if not value.strip() and ("\n" in value or "\r" in value) else value

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

