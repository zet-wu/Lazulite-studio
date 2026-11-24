"""Public dictionary v1 boundary validation. No content fingerprints."""
import json
import re
import stat
from operator import attrgetter
import zipfile
from pathlib import Path, PurePosixPath

import regex
import msgspec
from typing import Annotated


ShortText = Annotated[str, msgspec.Meta(min_length=1, max_length=1024)]
ReadingText = Annotated[str, msgspec.Meta(min_length=1, max_length=4096)]
SafeInt = Annotated[int, msgspec.Meta(ge=-(2**53-1), le=2**53-1)]

class SegmentRecord(msgspec.Struct):
    base: ShortText
    annotate: bool
    units: Annotated[tuple[ReadingText, ...], msgspec.Meta(max_length=1024)]

class CandidateRecord(msgspec.Struct):
    id: ShortText
    priority: SafeInt
    segments: Annotated[tuple[SegmentRecord, ...], msgspec.Meta(min_length=1, max_length=1024)]

class EntryRecord(msgspec.Struct):
    surface: ShortText
    candidates: Annotated[tuple[CandidateRecord, ...], msgspec.Meta(min_length=1, max_length=1024)]
    cost: Annotated[int, msgspec.Meta(ge=0, le=2**53-1)] | None = None

SEGMENT_BASE = attrgetter("base")
ENTRY_DECODER = msgspec.json.Decoder(EntryRecord)
REGULAR_SURFACE = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fffA-Za-z0-9]+\Z")
COMPLEX_GRAPHEME = regex.compile(r"[\p{M}\p{gcb=Prepend}\u1100-\u11ff\u200c\u200d\ud800-\uffff]")

HARD_BOUNDARIES = frozenset(',，、.。!！?？:：;；()（）[]［］{}｛｝「」『』【】〈〉《》“”"…⋯')


HARD_BOUNDARY_PATTERN = regex.compile("[\\s" + regex.escape("".join(HARD_BOUNDARIES)) + "\\x00]")

def hard_boundary(text):
    return any(c.isspace() or c in HARD_BOUNDARIES for c in text)


def nonempty(value, maximum=1000):
    return isinstance(value, str) and bool(value.strip()) and len(value) <= maximum and '\x00' not in value


def integer(value):
    return type(value) is int and abs(value) <= 2**53 - 1


def read_json(text):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError(f"重复 JSON 字段：{key}")
            result[key] = value
        return result
    return json.loads(text, object_pairs_hook=pairs)


def validate_manifest(m):
    if not isinstance(m, dict) or m.get("formatVersion") != 1 or type(m["formatVersion"]) is not int:
        raise ValueError("仅支持词典格式 v1")
    if not isinstance(m.get("id"), str) or not re.fullmatch(r"[a-z0-9][a-z0-9._-]{0,79}", m["id"]):
        raise ValueError("词典 ID 无效")
    if any(not nonempty(m.get(k)) for k in ("version", "name", "language", "region", "notation")):
        raise ValueError("词典说明不完整")
    if m.get("entries") != "entries.jsonl" or m.get("readingPolicy") != "fixed":
        raise ValueError("需要固定读音与 entries.jsonl")
    score = m.get("scoring")
    if not isinstance(score, dict) or score.get("mode") not in ("uniform", "weighted"):
        raise ValueError("评分模式无效")
    if score["mode"] == "weighted" and (not integer(score.get("unknownCost")) or score["unknownCost"] <= 0):
        raise ValueError("未命中代价无效")
    return m


def validate_entry(entry, mode):
    if not isinstance(entry, dict) or not nonempty(entry.get("surface"), 1024) or hard_boundary(entry["surface"]):
        raise ValueError("词条正文为空、过长或跨句读边界")
    if mode == "weighted":
        if not integer(entry.get("cost")) or entry["cost"] < 0:
            raise ValueError("增强模式需要非负整数 cost")
    elif "cost" in entry:
        raise ValueError("基础模式不能携带 cost")
    candidates = entry.get("candidates")
    if not isinstance(candidates, list) or not 1 <= len(candidates) <= 1024:
        raise ValueError("读音候选无效")
    ids = set()
    surface = entry["surface"]
    simple = COMPLEX_GRAPHEME.search(surface) is None
    ends = None if simple else {0, *(m.end() for m in regex.finditer(r"\X", surface))}
    for candidate in candidates:
        if not isinstance(candidate, dict) or not nonempty(candidate.get("id")) or candidate["id"] in ids or not integer(candidate.get("priority")):
            raise ValueError("候选标识或优先级无效")
        ids.add(candidate["id"])
        segments = candidate.get("segments")
        if not isinstance(segments, list) or not 1 <= len(segments) <= 1024:
            raise ValueError("正文对应段无效")
        offset, bases = 0, []
        for segment in segments:
            if not isinstance(segment, dict) or not nonempty(segment.get("base"), 1024) or type(segment.get("annotate")) is not bool:
                raise ValueError("正文对应段字段无效")
            units = segment.get("units")
            if not isinstance(units, list) or len(units) > 1024 or any(not nonempty(u, 4096) for u in units):
                raise ValueError("读音单元无效")
            if bool(units) != segment["annotate"]:
                raise ValueError("标注段须有读音，不标注段须为空列表")
            bases.append(segment["base"])
            offset += len(segment["base"])
            if ends is not None and offset not in ends:
                raise ValueError("正文对应段切断字素")
        if "".join(bases) != entry["surface"]:
            raise ValueError("对应段无法重组正文")
    return entry


def read_directory(directory, *, installed=False):
    directory = Path(directory)
    paths = list(directory.rglob("*"))
    if any(p.is_symlink() for p in paths):
        raise ValueError("词典资源包含链接")
    manifest = validate_manifest(read_json((directory / "manifest.json").read_text("utf-8")))
    sources = read_json((directory / "sources.json").read_text("utf-8"))
    if not isinstance(sources, (list, dict)) or not any(p.is_file() for p in (directory / "licenses").rglob("*")):
        raise ValueError("来源或许可信息缺失")
    seen = set()
    def entries():
        with (directory / "entries.jsonl").open("rb") as stream:
            for line in stream:
                if installed:
                    try:
                        entry = ENTRY_DECODER.decode(line)
                    except msgspec.DecodeError as exc:
                        raise ValueError(f"词典条目无效：{exc}") from exc
                    surface = entry.surface
                    ends = None
                    if REGULAR_SURFACE.fullmatch(surface) is None:
                        if HARD_BOUNDARY_PATTERN.search(surface):
                            raise ValueError("词条正文为空或跨句读边界")
                        if COMPLEX_GRAPHEME.search(surface) is not None:
                            ends = {0, *(m.end() for m in regex.finditer(r"\X", surface))}
                    if len(entry.candidates) > 1 and len({candidate.id for candidate in entry.candidates}) != len(entry.candidates):
                        raise ValueError("候选标识重复")
                    for candidate in entry.candidates:
                        if (candidate.segments[0].base if len(candidate.segments)==1 else "".join(map(SEGMENT_BASE,candidate.segments))) != surface:
                            raise ValueError("对应段无法重组正文")
                        if ends is not None:
                            offset = 0
                            for segment in candidate.segments:
                                offset += len(segment.base)
                                if offset not in ends:
                                    raise ValueError("正文对应段切断字素")
                    if (entry.cost is not None) != (manifest["scoring"]["mode"] == "weighted"):
                        raise ValueError("词条 cost 与评分模式不一致")
                    # Repeated segment values are validated once while the index
                    # interns them; duplicate JSON fields are checked during import.
                else:
                    entry = validate_entry(read_json(line.decode("utf-8")), manifest["scoring"]["mode"])
                    surface = entry["surface"]
                if surface in seen:
                    raise ValueError("正文重复，应在同一词条保留全部候选")
                seen.add(surface)
                yield entry
        if not seen:
            raise ValueError("词典没有可用词条")
    return manifest, sources, entries()


def extract_package(archive, target):
    target = Path(target)
    with zipfile.ZipFile(archive) as z:
        check_archive(z)
        z.extractall(target)
    return target


def check_archive(z):
    files = z.infolist()
    names = set()
    for f in files:
        if f.flag_bits & 1:
            raise ValueError("词典压缩包不能加密")
        name = f.filename
        path = PurePosixPath(name)
        if (not name or "\\" in name or ":" in name or "\x00" in name or path.is_absolute()
                or any(p in ("", ".", "..") for p in name.rstrip("/").split("/"))
                or stat.S_ISLNK(f.external_attr >> 16) or name.casefold() in names):
            raise ValueError("压缩包路径无效或重复")
        names.add(name.casefold())
        if not (name in ("manifest.json", "entries.jsonl", "sources.json") or name.startswith("licenses/")):
            raise ValueError("压缩包含格式外文件")
    if not {"manifest.json", "entries.jsonl", "sources.json"}.issubset(names):
        raise ValueError("压缩包缺少必需文件")

def inspect_package(archive):
    with zipfile.ZipFile(archive) as z:
        check_archive(z)
        manifest = validate_manifest(read_json(z.read("manifest.json").decode("utf-8")))
        sources = read_json(z.read("sources.json").decode("utf-8"))
        if not isinstance(sources, (list, dict)) or not any(
            f.filename.startswith("licenses/") and not f.is_dir() for f in z.infolist()
        ):
            raise ValueError("来源或许可信息缺失")
        return manifest, sources
