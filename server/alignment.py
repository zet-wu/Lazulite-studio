"""Global alignment orchestration; model work always runs outside the API process."""
import json
import os
from pathlib import Path
from dataclasses import asdict
from .engine import EngineUnavailable
from .vocals import VocalCancelled
from .vocal_process import VocalProcess
from .project_document import read_project
from .alignment_projection import project_alignment


def alignment_unavailable():
    from importlib.util import find_spec
    from lazulite.alignment.japanese.backend import HASHES
    path = os.getenv('STUDIO_NEXTFIRE_PATH')
    if not path or not all((Path(path)/name).is_file() for name in HASHES): return '未配置完整的 NextFire 模型目录（STUDIO_NEXTFIRE_PATH）'
    if any(find_spec(name) is None for name in ('torch', 'transformers', 'soundfile', 'demucs')): return '缺少自动对齐模型依赖'
    return None


class AlignmentRunner:
    def __init__(self, db, root):
        self.db, self.root = db, Path(root)
        self.worker = VocalProcess(module='server.alignment_worker')

    def close(self): self.worker.close()

    def snapshot(self, pid, revision):
        with self.db.connect() as c:
            current = c.execute('SELECT source_asset_id,current_revision FROM projects WHERE id=?', (pid,)).fetchone()
            if not current or current['current_revision'] != revision: raise ValueError('项目版本已改变，请重新运行')
            row = c.execute('SELECT project_path FROM revisions WHERE id=? AND project_id=?', (revision,pid)).fetchone()
            if not current['source_asset_id']: raise ValueError('请先上传源音频')
        return read_project(row[0]), current['source_asset_id']

    def validate(self, pid, params):
        if set(params) != {'revision', 'use_hints', 'line_blank', 'rest_blank', 'rest_token'} or not isinstance(params['revision'], str) or any(type(params[k]) is not bool for k in ('use_hints', 'line_blank', 'rest_blank', 'rest_token')):
            raise ValueError('自动对齐只接受项目版本及布尔对齐选项')
        snapshot, asset = self.snapshot(pid, params['revision'])
        projection = project_alignment(snapshot, params['use_hints'])
        if not projection['summary']['line_count']: raise ValueError('没有未跳过的歌词行')
        if not projection['summary']['emitting_count']: raise ValueError('没有可用读音，无法计算')
        reason = alignment_unavailable()
        if reason: raise ValueError(reason)
        params['asset_id'] = asset

    def run(self, pid, asset_path, params, jid, emit, cancelled):
        return self.worker.run({'database': str(Path(self.db.path).resolve()), 'root': str(self.root.resolve()),
            'project_id': pid, 'asset_path': str(Path(asset_path).resolve()), 'params': params, 'job_id': jid}, emit, cancelled)


def run_alignment(request, emit, cancelled):
    import soundfile as sf
    from lazulite.models.audio import AudioBuffer, VocalSegment, VocalAnalysis
    from lazulite.audio.preparation import prepare_existing_vocals
    from lazulite.models.japanese import JapaneseAlignmentRequest
    from lazulite.alignment.japanese.run import align_japanese
    from lazulite.alignment.japanese.run import JapaneseConfig
    from lazulite.alignment.japanese.backend import NextFireBackend, NextFireConfig
    from lazulite.cache import FileCache
    from .db import Database
    from .vocals import VocalRunner
    db = Database(request['database']); root = Path(request['root']); pid = request['project_id']; params = request['params']
    runner = AlignmentRunner(db, root)
    snapshot, asset = runner.snapshot(pid, params['revision'])
    if asset != params['asset_id']: raise ValueError('源音频已改变，请重新运行')
    if cancelled(): raise VocalCancelled()
    projection = project_alignment(snapshot, params['use_hints'])
    vocal = VocalRunner(db, root, cleanup=False)
    acoustics = snapshot['acoustics']; new_acoustics = None
    if acoustics['analysisId']:
        row, metadata = vocal.get(pid, acoustics['analysisId'])
        if row['status'] != 'ready' or metadata['source_asset_id'] != asset or metadata['separation_signature'] != vocal.separation_signature(asset) or not vocal.audio_available(pid, metadata):
            raise ValueError('现有人工片段无法匹配完整人声，请先检查音频处理')
    else:
        if acoustics['segments']: raise ValueError('现有片段没有可匹配的人声资源')
        result = vocal.run_in_process(pid, Path(request['asset_path']), {'asset_id': asset, 'model_name': 'htdemucs', 'device': os.getenv('STUDIO_VOCAL_DEVICE','cpu')}, request['job_id'], emit, cancelled)
        _, metadata = vocal.get(pid, result['analysis_id'])
        new_acoustics = {'analysisId': metadata['id'], 'segments': metadata['segments']}
    if cancelled(): raise VocalCancelled()
    samples, rate = sf.read(vocal.audio_path(pid, metadata), dtype='float32', always_2d=True)
    audio = AudioBuffer(samples.T, rate, metadata['audio_sha256'])
    def segments(rows):
        return tuple(VocalSegment(s['id'], None, s['beginMs']/1000, min(s['endMs']/1000,audio.duration), s['beginMs']/1000, min(s['endMs']/1000,audio.duration), None, None) for s in rows)
    selected = segments(acoustics['segments']) if acoustics['analysisId'] else None
    automatic = VocalAnalysis(audio.source_id, segments(metadata['segments']))
    with db.connect() as c:
        original = c.execute('SELECT sha256,duration_ms FROM assets WHERE id=?', (asset,)).fetchone()
    prepared = prepare_existing_vocals(audio, original_id=original['sha256'], original_duration=audio.duration,
        analysis=automatic, analysis_identity={'configuration': metadata['analysis_config'], 'source_sha256': metadata['analysis_source_sha256']},
        segments=selected, separation=metadata['model'])
    if not prepared.segments: raise ValueError('没有可用人声片段')
    backend = NextFireBackend(NextFireConfig(Path(os.environ['STUDIO_NEXTFIRE_PATH']), device=os.getenv('STUDIO_ALIGNMENT_DEVICE','cpu')))
    result = align_japanese(prepared, JapaneseAlignmentRequest.from_dict(projection['request']), backend=backend,
        config=JapaneseConfig(hint_mode='auto' if params['use_hints'] else 'off', **{k:params[k] for k in ('line_blank', 'rest_blank', 'rest_token')}), cache=FileCache(root/pid/'cache'/'alignment'),
        cancel=cancelled, event_sink=lambda event: emit('stage', event.stage, event.completed,event.total,event.message))
    if cancelled(): raise VocalCancelled()
    runner.snapshot(pid, params['revision'])
    if result.status == 'unresolved': raise ValueError('无法计算对齐：' + ', '.join(issue.code for issue in result.issues))
    return {'kind':'alignment', 'alignment':asdict(result), 'mapping':projection['mapping'], 'acoustics':new_acoustics, 'summary':projection['summary']}
