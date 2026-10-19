from pathlib import Path
import math
import numpy as np
from fastapi import APIRouter, Depends, HTTPException, Request
from .project_resources import stream_file
from .studio.media import Asset, MediaProbe

def build_vocal_router(runner, *, auth, project_exists):
    router = APIRouter()
    @router.get('/projects/{pid}/vocals')
    def results(pid: str, _=Depends(auth)):
        project_exists(pid)
        with runner.db.connect() as c:
            rows = c.execute('SELECT id,status,metadata_json FROM vocal_results WHERE project_id=? ORDER BY rowid DESC', (pid,)).fetchall()
        import json
        items = []
        settings, availability = {}, {}
        for row in rows:
            metadata = json.loads(row['metadata_json'])
            asset_id = metadata['source_asset_id']
            if asset_id not in settings: settings[asset_id] = runner.generation_settings(asset_id)
            owner = metadata['audio_result_id']
            if owner not in availability: availability[owner] = runner.audio_available(pid, metadata)
            available = availability[owner]
            state = 'missing' if not available else 'current' if metadata['generation_settings'] == settings[asset_id] else 'outdated'
            items.append({**metadata, 'status': row['status'], 'audio_id': metadata['audio_result_id'], 'audio_state': state})
        return {'items': items}

    @router.get('/projects/{pid}/vocals/{rid}/energy')
    def energy(pid: str, rid: str, start_ms: int, end_ms: int, buckets: int = 1000, _=Depends(auth)):
        project_exists(pid)
        try: row, metadata = runner.get(pid, rid)
        except KeyError: raise HTTPException(404, '分析结果不存在')
        if row['status'] != 'ready': raise HTTPException(409, '声学分析尚未完成')
        if start_ms < 0 or end_ms <= start_ms or not 1 <= buckets <= 4096:
            raise HTTPException(422, '能量视窗无效')
        end_ms = min(end_ms, metadata['duration_ms'])
        values = np.load(runner.db.paths.resolve(row['directory']) / 'energy.npy', mmap_mode='r', allow_pickle=False)
        hop = metadata['energy_hop_ms']
        first, last = max(0, int(start_ms / hop)), min(len(values), math.ceil(end_ms / hop))
        stride = max(1, math.ceil((last-first) / buckets))
        # Vectorized reduction keeps a cancelled HTTP request from occupying a worker
        # for a Python loop over thousands of buckets. Only the requested slice is read.
        samples = np.maximum.reduceat(values[first:last], np.arange(0, last-first, stride)).tolist() if last > first else []
        return {'start_ms': first*hop, 'step_ms': stride*hop, 'values': samples}

    @router.get('/projects/{pid}/vocals/{rid}/file')
    def file(pid: str, rid: str, request: Request, _=Depends(auth)):
        with runner.db.transaction():
            project_exists(pid)
            try: row, metadata = runner.get(pid, rid)
            except KeyError: raise HTTPException(404, '人声结果不存在')
            path = runner.audio_path(pid, metadata)
            if not runner.audio_available(pid, metadata): raise HTTPException(404, '人声文件不存在，请重新生成')
            response = stream_file(path, 'audio/wav', request.headers.get('range'), request.headers.get('if-range'))
            response.headers['Content-Disposition'] = 'attachment; filename="vocals.wav"'
            return response
    return router

def vocal_asset(runner, pid, rid):
    try: row, metadata = runner.get(pid, rid)
    except KeyError: raise HTTPException(404, '人声结果不存在')
    path = runner.audio_path(pid, metadata)
    if not runner.audio_available(pid, metadata): raise HTTPException(404, '人声文件不存在')
    # The producer already persisted these properties for this immutable PCM WAV.
    probe = MediaProbe(metadata['duration_ms'], 0, metadata['sample_rate'], metadata['channels'], 'pcm_s16le', 'wav', 'audio/wav')
    audio_id = metadata['audio_result_id']
    return Asset(audio_id, f'vocal-{audio_id}', path, 'vocals.wav', path.stat().st_size, probe, direct_pcm=True)
