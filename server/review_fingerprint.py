from __future__ import annotations
import hashlib
import xml.etree.ElementTree as ET

TTML = "http://www.w3.org/ns/ttml"

def fingerprint(root: ET.Element, line_id: str) -> str | None:
    """Hash a legal lyric p plus effective ancestor timing/agent context."""
    return fingerprints(root).get(line_id)

def fingerprints(root: ET.Element) -> dict[str, str]:
    body = next((node for node in root if node.tag == "{" + TTML + "}body"), None)
    if body is None:
        return {}
    semantic = {"begin", "end", "dur", "timeContainer", "agent"}
    result = {}
    def walk(node: ET.Element, context, path):
        local = node.tag.rsplit("}", 1)[-1]
        if not (node.tag.startswith("{" + TTML + "}") and local in {"body", "div", "p"}):
            return
        attrs = tuple(sorted((key, value) for key, value in node.attrib.items()
                             if key.rsplit("}", 1)[-1] in semantic))
        next_context = context + ((node.tag, attrs),)
        if local == "p":
            line_id = node.attrib.get("{http://www.w3.org/XML/1998/namespace}id") or "line-" + "-".join(map(str, path))
            tail = node.tail
            node.tail = None
            serialized = ET.tostring(node, encoding="utf-8").decode()
            node.tail = tail
            payload = repr((next_context, serialized)).encode()
            result[line_id] = hashlib.sha256(payload).hexdigest()
            return
        for child_index, child in enumerate(node):
            walk(child, next_context, path + [child_index])
    root_attrs = tuple(sorted((key, value) for key, value in root.attrib.items()
                              if key.rsplit("}", 1)[-1] in semantic))
    walk(body, ((root.tag, root_attrs),), [list(root).index(body)])
    return result
