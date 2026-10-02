from __future__ import annotations
import json, threading, uuid, hashlib, logging
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from typing import Any

from .db import Database
from .engine import EngineUnavailable, LazuliteEngine
from .reading import ReadingUnavailable
from .forced import ForcedUnavailable
from .publish import PublishInvalid
from .publishing import PublishingError
from .vocals import VocalCancelled

logger = logging.getLogger(__name__)

def now(): return datetime.now(timezone.utc).isoformat()

class JobService:
    """Durable single-slot executor. Every lifecycle transition is committed before notification."""
    def __init__(self, db: Database, *, engine=None, asset_path=None, reading_runner=None, publish_runner=None, vocal_runner=None):
        self.db, self.engine, self.asset_path, self.reading_runner, self.publish_runner = db, engine or LazuliteEngine(), asset_path, reading_runner, publish_runner
        self.vocal_runner = vocal_runner
        self._lock = threading.RLock(); self._pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="studio-job")
        with db.transaction() as c:
            rows = c.execute("SELECT id FROM jobs WHERE status IN ('queued','running','cancel_requested')").fetchall()
            for row in rows:
                t = now(); c.execute("UPDATE jobs SET status='interrupted',updated_at=?,finished_at=?,state_version=state_version+1 WHERE id=?", (t,t,row[0]))
                self._event(c,row[0],"state","interrupted",None,None,"服务重启，中断了未完成任务")

        self.reconcile_exports(startup=True)

    def reconcile_exports(self, *, startup=False):
        """Retire historical successes; retry deferred deletion without claiming success."""
        with self._lock:
            with self.db.transaction() as c:
                rows = c.execute("SELECT id,project_id,result_json FROM jobs WHERE kind='publish' AND status='succeeded' ORDER BY finished_at DESC,created_at DESC,id DESC").fetchall()
                seen = set()
                for row in rows:
                    result = json.loads(row['result_json'] or '{}')
                    if result.get('superseded') or result.get('report', {}).get('passed') is not True:
                        continue
                    if row['project_id'] in seen:
                        result['superseded'] = True
                        c.execute('UPDATE jobs SET result_json=? WHERE id=?', (json.dumps(result), row['id']))
                    else:
                        seen.add(row['project_id'])
            with self.db.connect() as c:
                records = c.execute("SELECT status,result_json FROM jobs WHERE kind='publish'").fetchall()
            keep, obsolete = set(), set()
            for row in records:
                result = json.loads(row['result_json'] or '{}')
                if result.get('output_path'):
                    path = Path(result['output_path'])
                    (keep if row['status'] == 'succeeded' and not result.get('superseded') and result.get('report', {}).get('passed') is True else obsolete).add(path)
            # Only at startup: no worker can still be writing an unrecorded temporary file.
            root = getattr(self.publish_runner, 'output_root', None)
            if startup and root:
                obsolete.update(path for path in Path(root).iterdir() if path.is_file() and path not in keep)
            for path in obsolete - keep:
                try:
                    path.unlink(missing_ok=True)
                except OSError:
                    logger.warning('Export cleanup deferred: %s', path)

    def _event(self,c,jid,kind,stage,completed,total,message):
        seq=c.execute("SELECT COALESCE(MAX(seq),0)+1 FROM job_events WHERE job_id=?",(jid,)).fetchone()[0]
        ver=c.execute("SELECT state_version FROM jobs WHERE id=?",(jid,)).fetchone()[0]
        c.execute("INSERT INTO job_events VALUES(?,?,?,?,?,?,?,?,?)",(jid,seq,kind,stage,completed,total,message,ver,now()))

    def create(self, project_id, kind, request, *, idem_key=None, subject="local"):
        digest=json.dumps([subject, kind, request],sort_keys=True,separators=(",",":"),ensure_ascii=False)
        with self.db.transaction() as c:
            if idem_key:
                old=c.execute("SELECT request_hash,job_id FROM job_idempotency WHERE project_id=? AND idem_key=?",(project_id,idem_key)).fetchone()
                if old:
                    if old[0]!=digest: raise ValueError("idempotency key was used for another request")
                    return self.get(old[1])
            if kind == 'vocal':
                active = c.execute("SELECT id FROM jobs WHERE project_id=? AND kind='vocal' AND status IN ('queued','running','cancel_requested')", (project_id,)).fetchone()
                if active: return self.get(active[0])
            if kind == 'publish' and c.execute("SELECT 1 FROM jobs WHERE project_id=? AND kind='publish' AND status IN ('queued','running','cancel_requested')", (project_id,)).fetchone():
                raise ValueError('此项目已有活动打包任务，请等待完成或取消')
            jid=uuid.uuid4().hex; t=now()
            c.execute("INSERT INTO jobs(id,project_id,kind,status,request_json,created_at,updated_at,state_version) VALUES(?,?,?,?,?,?,?,0)",(jid,project_id,kind,"queued",json.dumps(request, ensure_ascii=False),t,t))
            self._event(c,jid,"state","queued",0,1,"任务已排队")
            if idem_key: c.execute("INSERT INTO job_idempotency VALUES(?,?,?,?)",(project_id,idem_key,digest,jid))
        self._pool.submit(self._run,jid)
        return self.get(jid)

    def _run(self,jid):
        with self.db.transaction() as c:
            row=c.execute("SELECT * FROM jobs WHERE id=?",(jid,)).fetchone()
            if not row or row[3] != "queued": return
            t=now(); c.execute("UPDATE jobs SET status='running',started_at=?,updated_at=?,state_version=state_version+1 WHERE id=?",(t,t,jid)); self._event(c,jid,"state","running",0,1,"任务开始")
        result = None
        published = False
        try:
            with self.db.connect() as c: record=c.execute("SELECT * FROM jobs WHERE id=?",(jid,)).fetchone()
            if not record: return
            request=json.loads(record[4]); kind=record[2]
            if kind == "vocal":
                result = self.vocal_runner.run(record[1], self.asset_path(record[1]), request, jid,
                    lambda *x: self.emit(jid, *x), lambda: self.get(jid)['status'] == 'cancel_requested')
            elif kind == "reading":
                if self.reading_runner is None:
                    raise ReadingUnavailable("未配置读音后端")
                result = self.reading_runner.run(record[1], request)
            elif kind == "publish":
                if self.publish_runner is None:
                    raise RuntimeError("STPP publisher is not configured")
                result = self.publish_runner.run(record[1], request)
            else:
                result=self.engine.run(kind, asset_path=self.asset_path(record[1]) if self.asset_path else None, params=request, emit=lambda *x:self.emit(jid,*x))
            if kind != "vocal":
                with self.db.connect() as c:
                    project = c.execute("SELECT source_asset_id,current_revision FROM projects WHERE id=?", (record[1],)).fetchone()
                    bound_revision = request.get("revision")
                    bound_asset = request.get("asset_id")
                    rev = c.execute("SELECT project_path FROM revisions WHERE id=? AND project_id=?", (bound_revision, record[1])).fetchone()
                    if not rev:
                        raise RuntimeError("bound revision disappeared")
                    with open(rev[0], "rb") as source:
                        revision_hash = hashlib.sha256(source.read()).hexdigest()
                result["binding"] = {"project_id": record[1], "asset_id": bound_asset,
                                     "revision": bound_revision,
                                     "revision_sha256": revision_hash}
            with self._lock, self.db.transaction() as c:
                cancelled = c.execute('SELECT cancel_requested FROM jobs WHERE id=?', (jid,)).fetchone()
                if kind in {'publish', 'vocal'} and cancelled[0]:
                    t = now()
                    c.execute("UPDATE jobs SET status='cancelled',updated_at=?,finished_at=?,state_version=state_version+1 WHERE id=?", (t,t,jid))
                    self._event(c,jid,'state','cancelled',None,None,'打包已取消')
                    return
                if kind == 'publish':
                    for old in c.execute("SELECT id,result_json FROM jobs WHERE project_id=? AND kind='publish' AND status='succeeded'", (record[1],)).fetchall():
                        previous = json.loads(old['result_json'] or '{}')
                        previous['superseded'] = True
                        c.execute('UPDATE jobs SET result_json=? WHERE id=?', (json.dumps(previous),old['id']))
                t=now(); c.execute("UPDATE jobs SET status='succeeded',result_json=?,engine_json=?,updated_at=?,finished_at=?,state_version=state_version+1 WHERE id=? AND status IN ('running','cancel_requested')",(json.dumps(result,ensure_ascii=False),json.dumps(result.get("engine",{})),t,t,jid)); self._event(c,jid,"state","succeeded",1,1,"任务完成")
            published = True
            if kind == 'publish': self.reconcile_exports()
        except VocalCancelled:
            with self.db.transaction() as c:
                t = now()
                c.execute("UPDATE jobs SET status='cancelled',updated_at=?,finished_at=?,state_version=state_version+1 WHERE id=?", (t,t,jid))
                self._event(c,jid,'state','cancelled',None,None,'人声任务已在阶段边界停止')
        except (PublishInvalid, PublishingError) as exc: self._finish_error(jid, "publish_failed", str(exc))
        except (EngineUnavailable, ReadingUnavailable, ForcedUnavailable) as exc: self._finish_error(jid,"capability_unavailable",str(exc))
        except Exception as exc:
            logger.exception("job %s failed", jid)
            self._finish_error(jid, "engine_error", "Lazulite engine failed; inspect server logs")

        finally:
            if record and record[2] == 'vocal': self.vocal_runner.clean_unregistered(record[1], request.get('retry_analysis_id') or jid)
            if not published and isinstance(result, dict) and result.get('output_path') and record[2] == 'publish':
                try:
                    Path(result['output_path']).unlink(missing_ok=True)
                except OSError:
                    logger.warning('Unpublished export cleanup deferred: %s',result['output_path'])

    def _finish_error(self,jid,code,message):
        with self.db.transaction() as c:
            t=now(); c.execute("UPDATE jobs SET status='failed',error_json=?,updated_at=?,finished_at=?,state_version=state_version+1 WHERE id=? AND status IN ('running','cancel_requested')",(json.dumps({"code":code,"message":message}),t,t,jid)); self._event(c,jid,"state","failed",None,None,message)

    def emit(self,jid,kind,stage,completed=None,total=None,message=None):
        with self.db.transaction() as c: self._event(c,jid,kind,stage,completed,total,message)

    def cancel(self,jid):
        with self.db.transaction() as c:
            row=c.execute("SELECT status FROM jobs WHERE id=?",(jid,)).fetchone()
            if not row: return None
            if row[0]=="queued": status="cancelled"
            elif row[0]=="running": status="cancel_requested"
            else: return self.get(jid)
            t=now(); c.execute("UPDATE jobs SET status=?,cancel_requested=1,updated_at=?,finished_at=?,state_version=state_version+1 WHERE id=?",(status,t,t if status=="cancelled" else None,jid)); self._event(c,jid,"state",status,None,None,"收到取消请求")
        return self.get(jid)

    def get(self,jid):
        with self.db.connect() as c: row=c.execute("SELECT * FROM jobs WHERE id=?",(jid,)).fetchone()
        if not row: return None
        with self.db.connect() as c: stage = c.execute("SELECT stage FROM job_events WHERE job_id=? AND kind='stage' ORDER BY seq DESC LIMIT 1", (jid,)).fetchone()
        return {"stage": stage[0] if stage else None, "schema_version":"studio-job-v1","id":row[0],"project_id":row[1],"kind":row[2],"status":row[3],"request":json.loads(row[4]),"result_available":row[5] is not None,"error":json.loads(row[6]) if row[6] else None,"engine":json.loads(row[7]) if row[7] else None,"created_at":row[8],"updated_at":row[9],"state_version":row[13]}

    def events(self,jid,after=0):
        with self.db.connect() as c: rows=c.execute("SELECT * FROM job_events WHERE job_id=? AND seq>? ORDER BY seq",(jid,after)).fetchall()
        return [{"schema_version":"studio-job-event-v1","id":r[1],"job_id":r[0],"seq":r[1],"kind":r[2],"stage":r[3],"completed":r[4],"total":r[5],"message":r[6],"state_version":r[7],"created_at":r[8]} for r in rows]

    def result(self,jid):
        with self.db.connect() as c: row=c.execute("SELECT result_json FROM jobs WHERE id=?",(jid,)).fetchone()
        return json.loads(row[0]) if row and row[0] else None

    def close(self):
        self._pool.shutdown(wait=False, cancel_futures=False)
