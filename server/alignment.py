"""Global alignment orchestration; model work always runs outside the API process."""
import json
import os
from pathlib import Path
from dataclasses import asdict
from .engine import EngineUnavailable
from .runtime_devices import DeviceFailure, device_failure
from .vocals import VocalCancelled
from .vocal_process import VocalProcess
from .project_document import read_project
from .audio_boundaries import source_duration, intersect_segments
from .alignment_projection import project_alignment


def alignment_unavailable():
    from importlib.util import find_spec
    if any(find_spec(name) is None for name in ('torch', 'torchaudio', 'transformers', 'uroman', 'soundfile', 'demucs')): return {'code':'dependencies_missing','message':'Alignment model dependencies are missing'}
    return None


class AlignmentRunner:
    def __init__(self, db, root, models=None):
        self.db, self.root = db, Path(root)
        self.models = models
        self.worker = VocalProcess(module='server.alignment_worker')

    def close(self): self.worker.close()

    def snapshot(self, pid, revision):
        with self.db.transaction() as c:
            current = c.execute('SELECT source_asset_id,current_revision FROM projects WHERE id=?', (pid,)).fetchone()
            if not current or current['current_revision'] != revision: raise ValueError('项目版本已改变，请重新运行')
            row = c.execute('SELECT project_path FROM revisions WHERE id=? AND project_id=?', (revision,pid)).fetchone()
            if not current['source_asset_id']: raise ValueError('请先上传源音频')
            return read_project(self.db.paths.resolve(row[0])), current['source_asset_id']

    def validate(self, pid, params):
        if set(params) != {'revision', 'use_hints', 'line_blank', 'rest_blank', 'rest_token', 'clear_unmatched', 'smart_extend', 'merge_short_gaps', 'gap_threshold_ms', 'latin_normalize', 'strip_tone_digits', 'model_preview'} or not isinstance(params['revision'], str) or any(type(params[k]) is not bool for k in ('use_hints', 'line_blank', 'rest_blank', 'rest_token', 'clear_unmatched', 'smart_extend', 'merge_short_gaps', 'latin_normalize', 'strip_tone_digits')):
            raise ValueError('自动对齐只接受项目版本、布尔选项及行内空隙阈值')
        if type(params['gap_threshold_ms']) is not int or not 0 < params['gap_threshold_ms'] <= 9007199254740991:
            raise ValueError('行内空隙阈值必须为正的安全整数毫秒')
        if not params['merge_short_gaps']:
            params['gap_threshold_ms'] = 500
        snapshot, asset = self.snapshot(pid, params['revision'])
        if not isinstance(params['model_preview'], str): raise ValueError('需要有效模型预览')
        model = self.models.capture(params['model_preview'], {k:params[k] for k in ('latin_normalize','strip_tone_digits','revision')})
        projection = project_alignment(snapshot, params['use_hints'], model=model, **{k:params[k] for k in ('latin_normalize','strip_tone_digits')})
        params['_model'] = model
        if not projection['summary']['line_count']: raise ValueError('没有未跳过的歌词行')
        if not projection['summary']['emitting_count']: raise ValueError('没有可用读音，无法计算')
        reason = alignment_unavailable()
        if reason: raise ValueError(reason['message'])
        params['asset_id'] = asset

    def run(self, pid, asset_path, params, jid, emit, cancelled):
        return self.worker.run({'database': str(Path(self.db.path).resolve()), 'root': str(self.root.resolve()),
            'project_id': pid, 'asset_path': str(Path(asset_path).resolve()), 'params': params, 'job_id': jid}, emit, cancelled)


def run_alignment(request, emit, cancelled):
    from .studio.media_lifetime import MediaLifetime
    media_lifetime = MediaLifetime(Path(request['root']))
    with media_lifetime.use(request['project_id']):
        return _run_alignment(request, emit, cancelled, media_lifetime)


def _run_alignment(request, emit, cancelled, media_lifetime):
    from lazulite.models.audio import AudioBuffer, VocalSegment, VocalAnalysis
    from lazulite.audio.preparation import prepare_existing_vocals
    from lazulite.models.japanese import JapaneseAlignmentRequest
    from lazulite.alignment.japanese.run import align_japanese
    from lazulite.alignment.japanese.run import JapaneseConfig
    from lazulite.alignment.japanese.backend import open_backend
    from .alignment_models import check_snapshot
    from .db import Database
    from .vocals import VocalRunner
    db = Database(request['database']); root = Path(request['root']); pid = request['project_id']; params = request['params']
    runner = AlignmentRunner(db, root)
    snapshot, asset = runner.snapshot(pid, params['revision'])
    if asset != params['asset_id']: raise ValueError('源音频已改变，请重新运行')
    duration_ms = source_duration(db, pid, asset)
    if cancelled(): raise VocalCancelled()
    check_snapshot(params['_model'])
    projection = project_alignment(snapshot, params['use_hints'], model=params['_model'], **{k:params[k] for k in ('latin_normalize','strip_tone_digits')})
    vocal = VocalRunner(db, root, cleanup=False, media_lifetime=media_lifetime)
    acoustics = snapshot['acoustics']; new_acoustics = None
    if acoustics['analysisId']:
        row, metadata = vocal.get(pid, acoustics['analysisId'])
        if row['status'] != 'ready' or metadata['source_asset_id'] != asset or not vocal.audio_available(pid, metadata):
            raise ValueError('现有人工片段无法匹配完整人声，请先检查音频处理')
    else:
        if acoustics['segments']: raise ValueError('现有片段没有可匹配的人声资源')
        result = vocal.run_in_process(pid, Path(request['asset_path']), {'asset_id': asset, 'model_name': 'htdemucs', 'device': params.get('devices', {}).get('vocal', {}).get('actual', os.getenv('STUDIO_VOCAL_DEVICE','cpu'))}, request['job_id'], emit, cancelled)
        _, metadata = vocal.get(pid, result['analysis_id'])
        normalized, _ = intersect_segments(metadata['segments'], duration_ms)
        new_acoustics = {'analysisId': metadata['id'], 'segments': normalized}
    if cancelled(): raise VocalCancelled()
    samples, rate = vocal.decoded_audio(pid, metadata)
    audio = AudioBuffer(samples.T, rate, metadata['audio_result_id'])
    def segments(rows):
        # Samples are read only inside the decoded PCM, independently of source metadata.
        return tuple(VocalSegment(s['id'], None, max(0,s['beginMs']/1000), min(s['endMs']/1000,audio.duration), max(0,s['beginMs']/1000), min(s['endMs']/1000,audio.duration), None, None) for s in rows if max(0,s['beginMs']/1000) < min(s['endMs']/1000,audio.duration))
    selected = segments(acoustics['segments']) if acoustics['analysisId'] else None
    automatic_segments, automatic_normalization = intersect_segments(metadata['segments'], duration_ms)
    automatic = VocalAnalysis(audio.source_id, segments(automatic_segments))
    prepared = prepare_existing_vocals(audio, original_id=asset,
        analysis=automatic, analysis_description={'configuration': metadata['analysis_config'], 'reference':'full_scale'},
        segments=selected, separation=metadata['model'])
    if not prepared.segments: raise ValueError('没有可用人声片段')
    check_snapshot(params['_model'])
    backend = open_backend(params['_model']['path'], device=params.get('devices', {}).get('alignment', {}).get('actual', os.getenv('STUDIO_ALIGNMENT_DEVICE','cpu')))
    try:
        result = align_japanese(prepared, JapaneseAlignmentRequest.from_dict(projection['request']), backend=backend,
            config=JapaneseConfig(hint_mode='auto' if params['use_hints'] else 'off', **{k:params[k] for k in ('line_blank', 'rest_blank', 'rest_token', 'latin_normalize', 'strip_tone_digits')}),
            cancel=cancelled, event_sink=lambda event: emit('stage', event.stage))
    except RuntimeError as exc:
        device = params.get('devices', {}).get('alignment', {}).get('actual', os.getenv('STUDIO_ALIGNMENT_DEVICE','cpu'))
        if device_failure(exc, device): raise DeviceFailure('alignment', device) from exc
        raise
    finally:
        backend.close()
    if cancelled(): raise VocalCancelled()
    runner.snapshot(pid, params['revision'])
    if result.status == 'unresolved': raise ValueError('无法计算对齐：' + ', '.join(issue.code for issue in result.issues))
    expected = [(m['unit_id'],m['line_id']) for m in projection['mapping']]
    if [(u.unit_id,u.line_id) for u in result.units] != expected:
        raise ValueError('对齐结果与完整投影目标不匹配')
    # Execution metadata must not persist the installation path of the model.
    result_data = asdict(result)
    backend_info = result_data.get('execution', {}).get('backend', {})
    backend_info.pop('model_path', None)
    backend_info['model_name'] = params['_model']['name']
    from .alignment_postprocessing import object_timings
    timings = object_timings(result, projection['mapping'], audio, params['smart_extend'])
    return {'kind':'alignment', 'object_timings':timings, 'alignment':result_data, 'mapping':projection['mapping'], 'scope':projection['scope'], 'acoustics':new_acoustics, 'normalization':automatic_normalization, 'summary':projection['summary']}
