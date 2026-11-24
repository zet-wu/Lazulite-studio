"""Studio integer milliseconds; external engines and media keep native units."""
from decimal import Decimal, ROUND_HALF_UP
import re

_MEDIA_TIME = re.compile(r"^(?:\d+(?:\.\d+)?(?:ms|s)?|\d+:\d{2}(?::\d{2})?(?:\.\d+)?)$")


def parse_ttml_seconds(raw: str | None) -> Decimal | None:
    if raw is None:
        return None
    raw = raw.strip()
    if re.fullmatch(r"\d+(?:\.\d+)?ms", raw):
        return Decimal(raw[:-2]) / 1000
    if re.fullmatch(r"\d+(?:\.\d+)?s?", raw):
        return Decimal(raw.rstrip("s"))
    match = re.fullmatch(r"(?:(\d+):)?(\d+):(\d{2}(?:\.\d+)?)", raw)
    if match and Decimal(match[3]) < 60 and (match[1] is None or int(match[2]) < 60):
        return Decimal(match[1] or 0) * 3600 + Decimal(match[2]) * 60 + Decimal(match[3])
    raise ValueError("unsupported or invalid TTML time")


def try_parse_media_seconds(value: str | None) -> float | None:
    if value is None:
        return None
    value = value.strip()
    if not _MEDIA_TIME.match(value):
        return None
    if value.endswith("ms"):
        return float(value[:-2]) / 1000
    if value.endswith("s"):
        return float(value[:-1])
    if ":" not in value:
        return float(value)
    parts = value.split(":")
    h, m, rest = parts if len(parts) == 3 else ("0", *parts)
    return int(h) * 3600 + int(m) * 60 + float(rest)


def milliseconds(seconds):
    if seconds is None:
        return None
    value = Decimal(str(seconds)) * 1000
    if not value.is_finite() or value < 0:
        raise ValueError("time must be finite and non-negative")
    return int(value.quantize(Decimal(1), rounding=ROUND_HALF_UP))

def clock(ms):
    minutes, remainder = divmod(ms, 60000)
    seconds, fraction = divmod(remainder, 1000)
    hours, minutes = divmod(minutes, 60)
    tail = f"{minutes:02d}:{seconds:02d}.{fraction:03d}"
    return f"{hours:02d}:{tail}" if hours else tail


def normalize_ttml_tree(root):
    absolute = any(f'{{{namespace}}}timing' in root.attrib for namespace in ('http://music.apple.com/lyric-ttml-internal', 'http://itunes.apple.com/lyric-ttml-extensions'))
    def visit(node, parent):
        def position(name):
            raw = node.get(name)
            parsed = parse_ttml_seconds(raw)
            if parsed is None: return None
            return parsed if absolute or ':' in raw or not raw.endswith(('s','ms')) else parent + parsed
        begin, end = position('begin'), position('end')
        start = begin if begin is not None else parent
        duration = parse_ttml_seconds(node.get('dur'))
        if duration is not None:
            end = min(end, start+duration) if end is not None else start+duration
        # Keep distinct begin/end timestamps even when begin > end in TTML.
        for child in node: visit(child,start)
        if begin is not None: node.set('begin',clock(milliseconds(begin)))
        if end is not None and node.get('end') is not None: node.set('end',clock(milliseconds(end)))
        if duration is not None:
            # Preserve body duration, canonicalize other duration-only intervals.
            if node.tag.endswith('}body'): node.set('dur',clock(max(milliseconds(start), milliseconds(end))-milliseconds(start)))
            else:
                node.attrib.pop('dur')
                if node.get('begin') is None: node.set('begin',clock(milliseconds(start)))
                node.set('end',clock(milliseconds(end)))
    visit(root,Decimal(0))


def serialize_ttml(root):
    """Use unprefixed lyric elements, including Apple's nested default namespace.

    Some external consumers match literal element names instead of expanded names.
    Namespace URIs and every attribute/content remain intact.
    """
    import copy
    import xml.etree.ElementTree as ET
    tree=copy.deepcopy(root)
    ttml='http://www.w3.org/ns/ttml'
    apple='http://music.apple.com/lyric-ttml-internal'
    for prefix, uri in [('tts',ttml+'#styling'),('ttm',ttml+'#metadata'),('ttp',ttml+'#parameter'),('itunes',apple),('studio','urn:lazulite:studio:draft'),('amll','http://www.example.com/ns/amll')]:
        ET.register_namespace(prefix,uri)
    def visit(node,default=None):
        if node.tag.startswith('{'):
            uri,local=node.tag[1:].split('}',1)
            if uri in (ttml,apple):
                node.tag=local
                if uri!=default: node.set('xmlns',uri)
                default=uri
        for child in node: visit(child,default)
    visit(tree)
    return ET.tostring(tree,encoding='unicode')
