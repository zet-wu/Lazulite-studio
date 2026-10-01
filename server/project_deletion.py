"""Delete one project while excluding workers under the database write lock."""
import json
import logging
import shutil
import uuid
from pathlib import Path

from fastapi import HTTPException


def delete_project(db, root: Path, pid: str):
    staged = []
    trash = root / '.deleting' / uuid.uuid4().hex
    try:
        with db.transaction() as c:
            if not c.execute('SELECT 1 FROM projects WHERE id=?', (pid,)).fetchone():
                raise HTTPException(404, {'code': 'project_not_found', 'message': '项目不存在', 'retryable': False})
            if c.execute("SELECT 1 FROM jobs WHERE project_id=? AND status IN ('queued','running','cancel_requested')", (pid,)).fetchone():
                raise HTTPException(409, {'code': 'project_busy', 'message': '项目仍有任务运行，请先取消并等待任务结束', 'retryable': True})
            revisions = c.execute('SELECT id,ttml_path FROM revisions WHERE project_id=?', (pid,)).fetchall()
            jobs = c.execute('SELECT id,result_json FROM jobs WHERE project_id=?', (pid,)).fetchall()
            files = [Path(r[1]) for r in revisions] + [root / 'revisions' / f'{pid}.draft.ttml']
            for job in jobs:
                result = json.loads(job[1]) if job[1] else {}
                if result.get('output_path'):
                    path = Path(result['output_path']).resolve()
                    if (root / 'exports').resolve() not in path.parents:
                        raise ValueError('产物路径不属于项目存储')
                    files.append(path)
            # Assets and their shared proxies stay in the content addressed store.
            # No asset is removed while uploads, other projects or readers may use it.
            trash.mkdir(parents=True)
            for path in files:
                if path.is_file():
                    destination = trash / str(len(staged))
                    path.rename(destination)
                    staged.append((path, destination))
            for job in jobs:
                c.execute('DELETE FROM job_events WHERE job_id=?', (job[0],))
            for table in ('job_idempotency', 'jobs', 'reading_dictionary', 'review_confirmations', 'review_versions'):
                c.execute(f'DELETE FROM {table} WHERE project_id=?', (pid,))
            for identity in [pid, *(r[0] for r in revisions)]:
                c.execute("DELETE FROM idempotency WHERE json_extract(response,'$.id')=? OR json_extract(response,'$.project_id')=?", (identity, pid))
            c.execute('DELETE FROM revisions WHERE project_id=?', (pid,))
            c.execute('DELETE FROM projects WHERE id=?', (pid,))
    except Exception:
        for original, temporary in reversed(staged):
            temporary.rename(original)
        if trash.exists():
            shutil.rmtree(trash)
        raise
    # Once committed, quarantined bytes are no longer project data or downloadable.
    try:
        shutil.rmtree(trash)
    except OSError:
        logging.getLogger(__name__).warning('deleted project bytes await cleanup: %s', trash, exc_info=True)
    return {'deleted': pid}
