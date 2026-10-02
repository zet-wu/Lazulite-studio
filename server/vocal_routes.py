from pathlib import Path
import math
import numpy as np
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from .studio.media import Asset, probe_media

def build_vocal_router(runner, *, auth, project_exists):
    router = APIRouter()
    @router.get('/projects/{pid}/vocals')
    def results(pid: str, _=Depends(auth)):
        project_exists(pid)
        with runner.db.connect() as c:
            rows = c.execute('SELECT id,status,metadata_json FROM vocal_results WHERE project_id=? ORDER BY rowid DESC', (pid,)).fetchall()
        import json
        return {'items': [{**json.loads(r['metadata_json']), 'status': r['status']} for r in rows]}

    @router.get('/projects/{pid}/vocals/{rid}/energy')
    def energy(pid: str, rid: str, start_ms: int, end_ms: int, buckets: int = 1000, _=Depends(auth)):
        project_exists(pid)
        try: row, metadata = runner.get(pid, rid)
        except KeyError: raise HTTPException(404, '分析结果不存在')
        if row['status'] != 'ready': raise HTTPException(409, '声学分析尚未完成')
        if start_ms < 0 or end_ms <= start_ms or end_ms > metadata['duration_ms'] + 1 or not 1 <= buckets <= 4096:
            raise HTTPException(422, '能量视窗无效')
        values = np.load(Path(row['directory']) / 'energy.npy', mmap_mode='r', allow_pickle=False)
        hop = metadata['energy_hop_ms']
        first, last = max(0, int(start_ms / hop)), min(len(values), math.ceil(end_ms / hop))
        stride = max(1, math.ceil((last-first) / buckets))
        samples = [float(np.max(values[i:min(i+stride,last)])) for i in range(first,last,stride)]
        return {'start_ms': first*hop, 'step_ms': stride*hop, 'values': samples}

    @router.get('/projects/{pid}/vocals/{rid}/file')
    def file(pid: str, rid: str, _=Depends(auth)):
        project_exists(pid)
        try: row, _ = runner.get(pid, rid)
        except KeyError: raise HTTPException(404, '人声结果不存在')
        return FileResponse(Path(row['directory']) / 'vocals.flac', media_type='audio/flac')
    return router

def vocal_asset(runner, pid, rid):
    try: row, metadata = runner.get(pid, rid)
    except KeyError: raise HTTPException(404, '人声结果不存在')
    path = Path(row['directory']) / 'vocals.flac'
    if not path.is_file(): raise HTTPException(404, '人声文件不存在')
    return Asset(rid, f'vocal-{rid}', path, 'vocals.flac', path.stat().st_size, probe_media(path))
