"""Source replacement uses a recoverable directory swap under the job/write lock."""
import json
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path
from fastapi import HTTPException
from .atomic_file import write_atomic, fsync_directory
from .project_document import read_project


def fail(code, message, status=409):
    raise HTTPException(status, {'code': code, 'message': message, 'retryable': False})


def _recover(db, root, journal):
    marker = journal / 'intent.json'
    if not marker.exists():
        shutil.rmtree(journal)
        return
    intent = json.loads(marker.read_text())
    destination = root / 'projects' / journal.name
    with db.transaction() as conn:
        row = conn.execute('SELECT source_asset_id FROM projects WHERE id=?', (journal.name,)).fetchone()
        committed = row is not None and row[0] == intent['asset_id']
        backup = journal / 'previous'
        if not committed and backup.exists():
            if destination.exists(): shutil.rmtree(destination)
            backup.rename(destination)
            fsync_directory(destination.parent)
        shutil.rmtree(journal)


def recover_music_replacements(db, root):
    failures = []
    for journal in (root / '.replacing').glob('*'):
        try: _recover(db, root, journal)
        except OSError: failures.append(journal.name)
    return failures


def replace_music(db, root, pid, upload_id, revision, expected_asset, operation_id, subject, staged_upload, asset_dto):
    root = Path(root)
    journal = root / '.replacing' / pid
    request_key = json.dumps([pid, upload_id, revision, expected_asset], separators=(',', ':'))
    cleanup_pending = False
    if journal.exists():
        try: _recover(db, root, journal)
        except OSError: cleanup_pending = True
    try:
        with db.transaction() as conn:
            project = conn.execute('SELECT source_asset_id,current_revision FROM projects WHERE id=?', (pid,)).fetchone()
            if not project: fail('project_not_found', '项目已删除', 404)
            previous = conn.execute('SELECT subject,request_hash,response FROM idempotency WHERE key=?', (operation_id,)).fetchone()
            if previous:
                if previous[0] != subject or previous[1] != request_key: fail('idempotency_mismatch', '操作标识已用于其他请求')
                response = json.loads(previous[2])
                if project[0] != response['asset']['id']: fail('music_operation_superseded', '本次导入之后音频已再次改变，请重新读取项目')
                stage = root / 'uploads' / upload_id
                try:
                    if stage.exists(): shutil.rmtree(stage)
                except OSError: cleanup_pending = True
                return {**response, 'cleanup_pending': cleanup_pending}
            if cleanup_pending: fail('music_cleanup_pending', '音频切换文件尚未释放，请停止播放／下载后重试')
            if project[1] != revision: fail('revision_conflict', '项目已在其他页面更新，请先处理保存冲突', 412)
            if project[0] != expected_asset: fail('source_conflict', '源音频已改变，请重新读取项目')
            if conn.execute("SELECT 1 FROM jobs WHERE project_id=? AND status IN ('queued','running','cancel_requested')", (pid,)).fetchone():
                fail('project_busy', '项目仍有任务运行，请先取消并等待任务结束')
            staged, record = staged_upload(upload_id)
            old_revision = conn.execute('SELECT project_path FROM revisions WHERE id=? AND project_id=?', (revision, pid)).fetchone()
            snapshot = read_project(db.paths.resolve(old_revision[0]))
            snapshot['acoustics'] = {'analysisId': None, 'segments': []}
            new_revision = uuid.uuid4().hex
            stamp = datetime.now(timezone.utc).isoformat()
            journal.mkdir(parents=True)
            prepared = journal / 'prepared'
            prepared.mkdir()
            # Copies leave the successfully probed upload retryable until commit.
            for name in ('source', 'cache'): shutil.copytree(staged / name, prepared / name)
            write_atomic(prepared / 'revisions' / f'{new_revision}.json', json.dumps(snapshot, ensure_ascii=False).encode())
            write_atomic(journal / 'intent.json', json.dumps({'asset_id': upload_id}).encode())
            destination = root / 'projects' / pid
            destination.rename(journal / 'previous')
            fsync_directory(journal)
            prepared.rename(destination)
            fsync_directory(destination.parent)
            conn.execute('INSERT INTO assets VALUES(?,?,?,?,?,?,?,?,?,?,?,?)', record)
            conn.execute("DELETE FROM idempotency WHERE json_extract(response,'$.id')=? OR json_extract(response,'$.id') IN (SELECT id FROM revisions WHERE project_id=?)", (pid,pid))
            for table in ('vocal_results','job_idempotency','jobs','revisions'):
                conn.execute(f'DELETE FROM {table} WHERE project_id=?', (pid,))
            path = db.paths.store(destination / 'revisions' / f'{new_revision}.json')
            conn.execute('INSERT INTO revisions VALUES(?,?,?,?,?)', (new_revision,pid,None,path,stamp))
            conn.execute('UPDATE projects SET source_asset_id=?,current_revision=?,updated_at=? WHERE id=?', (upload_id,new_revision,stamp,pid))
            if expected_asset: conn.execute('DELETE FROM assets WHERE id=?', (expected_asset,))
            response = {'asset': asset_dto(conn.execute('SELECT * FROM assets WHERE id=?', (upload_id,)).fetchone()), 'revision': new_revision, 'cleanup_pending': False}
            conn.execute('INSERT INTO idempotency VALUES(?,?,?,?,?)', (operation_id,subject,request_key,json.dumps(response),stamp))
    except Exception:
        if journal.exists(): _recover(db, root, journal)
        raise
    try:
        _recover(db, root, journal)
        shutil.rmtree(staged)
    except OSError:
        response['cleanup_pending'] = True
    return response
