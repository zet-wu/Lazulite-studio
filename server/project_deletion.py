"""Project directory quarantine and database commit share the SQLite write lock."""
import logging
import shutil
from pathlib import Path
from fastapi import HTTPException


def recover_deletions(db, root: Path):
    trash = root / '.deleting'
    with db.transaction() as c:
        for directory in trash.glob('*'):
            destination = root / 'projects' / directory.name
            if c.execute('SELECT 1 FROM projects WHERE id=?', (directory.name,)).fetchone():
                destination.parent.mkdir(parents=True, exist_ok=True)
                directory.rename(destination)
            else:
                shutil.rmtree(directory)


def delete_project(db, root: Path, pid: str):
    directory = root / 'projects' / pid
    trash = root / '.deleting' / pid
    moved = False
    try:
        with db.transaction() as c:
            project = c.execute('SELECT source_asset_id FROM projects WHERE id=?', (pid,)).fetchone()
            if not project:
                raise HTTPException(404, {'code':'project_not_found','message':'项目不存在','retryable':False})
            if c.execute("SELECT 1 FROM jobs WHERE project_id=? AND status IN ('queued','running','cancel_requested')", (pid,)).fetchone():
                raise HTTPException(409, {'code':'project_busy','message':'项目仍有任务运行，请先取消并等待任务结束','retryable':True})
            trash.parent.mkdir(parents=True, exist_ok=True)
            if directory.exists():
                directory.rename(trash)
                moved = True
            c.execute("DELETE FROM idempotency WHERE json_extract(response,'$.id')=? OR json_extract(response,'$.id') IN (SELECT id FROM revisions WHERE project_id=?)", (pid,pid))
            for table in ('vocal_results','search_conditions','job_idempotency','jobs','revisions'):
                c.execute(f'DELETE FROM {table} WHERE project_id=?', (pid,))
            c.execute('DELETE FROM projects WHERE id=?', (pid,))
            c.execute('DELETE FROM assets WHERE id=?', (project[0],))
    except Exception:
        if moved: trash.rename(directory)
        raise
    if moved:
        try: shutil.rmtree(trash)
        except OSError:
            logging.getLogger(__name__).warning('项目已删除，暂存文件将在重启时重试释放：%s', trash, exc_info=True)
    return {'deleted':pid}
