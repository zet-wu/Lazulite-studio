"""The only persisted editable project format. Audio products live separately."""
import json
from pathlib import Path
from pydantic import BaseModel, ConfigDict, Field, StrictInt
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

class ProjectSnapshot(BaseModel):
    model_config = ConfigDict(extra='forbid')
    schemaVersion: Literal['studio-project-v1']
    sourceAssetId: str | None
    lyrics: Lyrics
    acoustics: Acoustics

def initial_project(ttml: str, asset_id: str | None) -> dict:
    return {'schemaVersion': 'studio-project-v1', 'sourceAssetId': asset_id,
            'lyrics': {'draftTtml': ttml}, 'acoustics': {'analysisId': None, 'segments': []}}

def read_project(path: str | Path) -> dict:
    return ProjectSnapshot.model_validate_json(Path(path).read_text(encoding='utf-8')).model_dump()

def read_lyrics(path: str | Path) -> str:
    return read_project(path)['lyrics']['draftTtml']

def validate_project(value: dict, conn, project_id: str) -> dict:
    from .documents import validate_ttml
    from .time_units import normalize_ttml
    snapshot = ProjectSnapshot.model_validate(value).model_dump()
    row = conn.execute('SELECT p.source_asset_id,a.duration_ms FROM projects p LEFT JOIN assets a ON a.id=p.source_asset_id WHERE p.id=?', (project_id,)).fetchone()
    if row is None: raise KeyError(project_id)
    if snapshot['sourceAssetId'] != row[0]: raise ValueError('项目源音频不匹配')
    snapshot['lyrics']['draftTtml'] = normalize_ttml(validate_ttml(snapshot['lyrics']['draftTtml']))
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
