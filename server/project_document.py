"""The only persisted editable project format. Audio products live separately."""
import json
from pathlib import Path
from pydantic import BaseModel, ConfigDict, Field, StrictInt, StrictBool
from typing import Literal
from .karaoke import Karaoke, initial_karaoke
from .document_errors import DocumentInvalid

class Segment(BaseModel):
    model_config = ConfigDict(extra='forbid')
    id: str = Field(min_length=1, max_length=200)
    beginMs: StrictInt
    endMs: StrictInt

class Acoustics(BaseModel):
    model_config = ConfigDict(extra='forbid')
    analysisId: str | None = None
    segments: list[Segment] = Field(default_factory=list, max_length=100000)

class Lyrics(BaseModel):
    model_config = ConfigDict(extra='forbid')
    draftTtml: str = Field(min_length=1)

class EmptyBeat(BaseModel):
    model_config = ConfigDict(extra='forbid')
    kind: Literal['word', 'ruby']
    count: StrictInt = Field(ge=1, le=32)

class Editing(BaseModel):
    model_config = ConfigDict(extra='forbid')
    emptyBeats: dict[str, EmptyBeat]
    skippedAlignmentLineIds: list[str]
    ignoredSyncLineIds: list[str]
    endLinks: dict[str, str]

class AmllSettings(BaseModel):
    model_config = ConfigDict(extra='forbid')
    simplified: StrictBool
    noMultipleBackgrounds: StrictBool
    noChorus: StrictBool
    noWordAgents: StrictBool
    noIndependentBackground: StrictBool

class ProjectSnapshot(BaseModel):
    model_config = ConfigDict(extra='forbid')
    schemaVersion: Literal['studio-project-v9']
    karaoke: Karaoke
    amll: AmllSettings
    lineOrder: list[str]
    lyrics: Lyrics
    acoustics: Acoustics
    editing: Editing

def initial_project(ttml: str, asset_id: str | None) -> dict:
    from .amll_compatibility import DEFAULTS
    return {'schemaVersion': 'studio-project-v9', 'karaoke': initial_karaoke(ttml), 'amll': dict(DEFAULTS), 'lineOrder': [],
            'editing': {'emptyBeats': {}, 'skippedAlignmentLineIds': [], 'ignoredSyncLineIds': [], 'endLinks': {}}, 'lyrics': {'draftTtml': ttml}, 'acoustics': {'analysisId': None, 'segments': []}}

def read_project(path: str | Path) -> dict:
    snapshot = _validate_snapshot(ProjectSnapshot.model_validate_json(Path(path).read_text(encoding='utf-8')))
    return snapshot

def read_lyrics(path: str | Path) -> str:
    return read_project(path)['lyrics']['draftTtml']

def validate_project(value: dict | ProjectSnapshot, conn, project_id: str) -> dict:
    snapshot = _validate_snapshot(value if isinstance(value, ProjectSnapshot) else ProjectSnapshot.model_validate(value))
    row = conn.execute('SELECT source_asset_id FROM projects WHERE id=?', (project_id,)).fetchone()
    if row is None: raise KeyError(project_id)
    acoustic = snapshot['acoustics']
    if acoustic['analysisId'] is not None:
        result = conn.execute('SELECT source_asset_id FROM vocal_results WHERE id=? AND project_id=? AND status=?', (acoustic['analysisId'], project_id, 'ready')).fetchone()
        if result is None or result[0] != row[0]: raise DocumentInvalid('analysis_source_mismatch', '声学分析不属于当前项目源音频', analysis_id=acoustic['analysisId'])
    ids = set()
    for segment in acoustic['segments']:
        if segment['id'] in ids:
            raise DocumentInvalid('segment_duplicate_id', f"人声片段 {segment['id']} 标识重复", object_id=segment['id'])
        if not 0 <= segment['beginMs'] < segment['endMs'] <= 9007199254740991:
            raise DocumentInvalid('segment_invalid_range', f"人声片段 {segment['id']} 时间须为非负安全整数且结束晚于开始", object_id=segment['id'], begin_ms=segment['beginMs'], end_ms=segment['endMs'])
        ids.add(segment['id'])
    return snapshot


def _validate_snapshot(model: ProjectSnapshot) -> dict:
    from .documents import validate_ttml
    from .time_units import normalize_ttml_tree, serialize_ttml
    from .amll_compatibility import validate_amll
    snapshot = model.model_dump()
    root = validate_ttml(snapshot['lyrics']['draftTtml'])
    normalize_ttml_tree(root)
    snapshot['lyrics']['draftTtml'] = serialize_ttml(root)
    validate_editing(snapshot, root)
    validate_amll(snapshot, root)
    return snapshot


def validate_editing(snapshot, root):
    from decimal import Decimal
    studio = '{urn:lazulite:studio:draft}'
    tt = '{http://www.w3.org/ns/ttml}'
    tts = '{http://www.w3.org/ns/ttml#styling}'
    ttm = '{http://www.w3.org/ns/ttml#metadata}'
    xml = '{http://www.w3.org/XML/1998/namespace}'
    objects, lines, backgrounds = {}, {}, set()
    def identity(node, kind):
        key = node.get(studio+'id') or node.get(xml+'id')
        if key:
            if key in objects: raise DocumentInvalid('editing_duplicate_id', f'编辑对象 {key} 标识重复', object_id=key)
            objects[key] = kind
        return key
    def words(node):
        for child in node:
            if child.tag != tt+'span' or any(role != 'expletive' for role in child.get(ttm+'role', '').split()): continue
            identity(child, 'word')
            for unit in child.iter():
                if unit.get(tts+'ruby') == 'text': identity(unit, 'ruby')
    for node in root.iter():
        if any(studio+field in node.attrib for field in ['emptyBeat','ignoreSync','endLink','order','members']): raise DocumentInvalid('editing_obsolete_attributes', '歌词包含不支持的编辑属性')
        if node.tag == tt+'p':
            key = identity(node, 'line')
            if key: lines[key] = node
            words(node)
            for child in node:
                if child.get(ttm+'role') == 'x-bg':
                    key = identity(child, 'line')
                    if key: lines[key] = child; backgrounds.add(key)
                    words(child)
    editing = snapshot['editing']
    for key, beat in editing['emptyBeats'].items():
        if objects.get(key) != beat['kind']: raise DocumentInvalid('empty_beat_invalid_reference', f'空拍对象 {key} 或类别不合法', object_id=key, kind=beat['kind'])
    skipped = editing['skippedAlignmentLineIds']
    if len(set(skipped)) != len(skipped) or any(key not in lines for key in skipped): raise DocumentInvalid('skipped_alignment_invalid_reference', '跳过对齐的行引用无效或重复', object_ids=skipped)
    ignored = editing['ignoredSyncLineIds']
    if len(set(ignored)) != len(ignored) or any(key not in lines for key in ignored): raise DocumentInvalid('ignored_sync_invalid_reference', '忽略打轴的行引用无效或重复', object_ids=ignored)
    def time(node, side):
        if side in node.get(studio+'null', '').split(): return None
        raw = node.get(side)
        if raw is None: return None
        value = Decimal(0)
        for part in raw.split(':'): value = value * 60 + Decimal(part)
        return int(value * 1000)
    for source, target in editing['endLinks'].items():
        if source not in lines or target not in lines or source == target or source in backgrounds or target in backgrounds: raise DocumentInvalid('end_link_invalid_reference', f'行尾链接 {source} → {target} 不合法', object_id=source, target_id=target)
        line, destination = lines[source], lines[target]
        end, begin = time(line, 'end'), time(destination, 'begin')
        if begin is None or end != begin or time(line, 'begin') is not None and time(line, 'begin') > end: raise DocumentInvalid('end_link_invalid_time', f'行尾链接 {source} 的时间与目标行不一致', object_id=source, target_id=target)
        for child in line:
            if child.tag == tt+'span' and all(role == 'expletive' for role in child.get(ttm+'role', '').split()) and time(child, 'end') is not None and time(child, 'end') > end: raise DocumentInvalid('end_link_excludes_word', f'行 {source} 的链接结束时间未包含正文词', object_id=source, target_id=target)
