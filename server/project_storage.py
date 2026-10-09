"""On-demand logical byte totals; no cached totals to invalidate on file writes."""
import os
import stat
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException


def project_storage(directory):
    totals = dict(source=0, vocals=0, cache=0, snapshots=0, other=0)
    def scan(folder, category=None):
        with os.scandir(folder) as entries:
            for entry in entries:
                info = entry.stat(follow_symlinks=False)
                if stat.S_ISLNK(info.st_mode): raise OSError('项目目录包含符号链接，无法统计')
                kind = category or {'source':'source', 'vocals':'vocals', 'cache':'cache', 'revisions':'snapshots', 'draft':'snapshots'}.get(entry.name, 'other')
                if stat.S_ISDIR(info.st_mode): scan(entry.path, kind)
                elif stat.S_ISREG(info.st_mode): totals[kind] += info.st_size
    scan(directory)
    return {'total_bytes':sum(totals.values()), 'categories':totals, 'measured_at':datetime.now(timezone.utc).isoformat()}


def build_storage_router(db, root, *, auth, project_exists):
    router = APIRouter()
    @router.get('/projects/{pid}/storage')
    def storage(pid: str, _=Depends(auth)):
        with db.transaction():
            project_exists(pid)
            try: return project_storage(root / 'projects' / pid)
            except OSError as exc: raise HTTPException(503, '项目空间统计失败，请刷新重试') from exc
    return router
