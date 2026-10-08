"""The only persisted editable project format. Audio products live separately."""
import json
from pathlib import Path
from pydantic import BaseModel, ConfigDict, Field, StrictInt, StrictBool
from typing import Literal

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
    draftTtml: str = Field(min_length=1, max_length=2 * 1024 * 1024)

class EmptyBeat(BaseModel):
    model_config = ConfigDict(extra='forbid')
    kind: Literal['word', 'ruby']
    count: StrictInt = Field(ge=1, le=32)

class Editing(BaseModel):
    model_config = ConfigDict(extra='forbid')
    emptyBeats: dict[str, EmptyBeat]
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
    schemaVersion: Literal['studio-project-v4']
    amll: AmllSettings
    lineOrder: list[str]
    lyrics: Lyrics
    acoustics: Acoustics
    editing: Editing

def initial_project(ttml: str, asset_id: str | None) -> dict:
    from .amll_compatibility import DEFAULTS
    return {'schemaVersion': 'studio-project-v4', 'amll': dict(DEFAULTS), 'lineOrder': [],
            'editing': {'emptyBeats': {}, 'ignoredSyncLineIds': [], 'endLinks': {}}, 'lyrics': {'draftTtml': ttml}, 'acoustics': {'analysisId': None, 'segments': []}}

def read_project(path: str | Path) -> dict:
    snapshot = ProjectSnapshot.model_validate_json(Path(path).read_text(encoding='utf-8')).model_dump()
    validate_editing(snapshot)
    from .amll_compatibility import validate_amll
    validate_amll(snapshot)
    return snapshot

def read_lyrics(path: str | Path) -> str:
    return read_project(path)['lyrics']['draftTtml']

def validate_project(value: dict, conn, project_id: str) -> dict:
    from .documents import validate_ttml
    from .time_units import normalize_ttml
    snapshot = ProjectSnapshot.model_validate(value).model_dump()
    row = conn.execute('SELECT p.source_asset_id,a.duration_ms FROM projects p LEFT JOIN assets a ON a.id=p.source_asset_id WHERE p.id=?', (project_id,)).fetchone()
    if row is None: raise KeyError(project_id)
    snapshot['lyrics']['draftTtml'] = normalize_ttml(validate_ttml(snapshot['lyrics']['draftTtml']))
    validate_editing(snapshot)
    from .amll_compatibility import validate_amll
    validate_amll(snapshot)
    acoustic = snapshot['acoustics']
    if acoustic['analysisId'] is not None:
        result = conn.execute('SELECT source_asset_id FROM vocal_results WHERE id=? AND project_id=? AND status=?', (acoustic['analysisId'], project_id, 'ready')).fetchone()
        if result is None or result[0] != row[0]: raise ValueError('声学分析不属于当前项目源音频')
    ids = set()
    for segment in acoustic['segments']:
        if segment['id'] in ids or not 0 <= segment['beginMs'] < segment['endMs'] <= (row[1] or 0):
            raise ValueError('人声片段标识重复或时间超出歌曲范围')
        ids.add(segment['id'])
    return snapshot


def validate_editing(snapshot):
    import xml.etree.ElementTree as ET
    from decimal import Decimal
    from .time_units import normalize_ttml
    root = ET.fromstring(normalize_ttml(snapshot['lyrics']['draftTtml']))
    studio = '{urn:lazulite:studio:draft}'
    tt = '{http://www.w3.org/ns/ttml}'
    tts = '{http://www.w3.org/ns/ttml#styling}'
    ttm = '{http://www.w3.org/ns/ttml#metadata}'
    xml = '{http://www.w3.org/XML/1998/namespace}'
    objects, lines, backgrounds = {}, {}, set()
    def identity(node, kind):
        key = node.get(studio+'id') or node.get(xml+'id')
        if key:
            if key in objects: raise ValueError('duplicate editing object ID')
            objects[key] = kind
        return key
    def words(node):
        for child in node:
            if child.tag != tt+'span' or any(role != 'expletive' for role in child.get(ttm+'role', '').split()): continue
            identity(child, 'word')
            for unit in child.iter():
                if unit.get(tts+'ruby') == 'text': identity(unit, 'ruby')
    for node in root.iter():
        if any(studio+field in node.attrib for field in ['emptyBeat','ignoreSync','endLink','order','members']): raise ValueError('obsolete lyric editing attributes')
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
        if objects.get(key) != beat['kind']: raise ValueError('empty beat object or category is invalid')
    ignored = editing['ignoredSyncLineIds']
    if len(set(ignored)) != len(ignored) or any(key not in lines for key in ignored): raise ValueError('ignored sync line is invalid')
    def time(node, side):
        if side in node.get(studio+'null', '').split(): return None
        raw = node.get(side)
        if raw is None: return None
        value = Decimal(0)
        for part in raw.split(':'): value = value * 60 + Decimal(part)
        return int(value * 1000)
    for source, target in editing['endLinks'].items():
        if source not in lines or target not in lines or source == target or source in backgrounds or target in backgrounds: raise ValueError('invalid end link relationship')
        line, destination = lines[source], lines[target]
        end, begin = time(line, 'end'), time(destination, 'begin')
        if begin is None or end != begin or time(line, 'begin') is not None and time(line, 'begin') > end: raise ValueError('invalid evaluated end link')
        for child in line:
            if child.tag == tt+'span' and all(role == 'expletive' for role in child.get(ttm+'role', '').split()) and time(child, 'end') is not None and time(child, 'end') > end: raise ValueError('linked end excludes word')
