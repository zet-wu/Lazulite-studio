from __future__ import annotations
import json, threading, uuid, hashlib, logging
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from typing import Any

from .db import Database
from .engine import EngineUnavailable, LazuliteEngine

logger = logging.getLogger(__name__)

def now(): return datetime.now(timezone.utc).isoformat()

class JobService:
    """Durable single-slot executor. Every lifecycle transition is committed before notification."""
    def __init__(self, db: Database, *, engine=None, asset_path=None):
        self.db, self.engine, self.asset_path = db, engine or LazuliteEngine(), asset_path
        self._lock = threading.Lock(); self._pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="studio-job")
        with db.transaction() as c:
            rows = c.execute("SELECT id FROM jobs WHERE status IN ('queued','running','cancel_requested')").fetchall()
            for row in rows:
                t = now(); c.execute("UPDATE jobs SET status='interrupted',updated_at=?,finished_at=?,state_version=state_version+1 WHERE id=?", (t,t,row[0]))
                self._event(c,row[0],"state","interrupted",None,None,"服务重启，中断了未完成任务")

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
        try:
            with self.db.connect() as c: record=c.execute("SELECT * FROM jobs WHERE id=?",(jid,)).fetchone()
            if not record: return
            request=json.loads(record[4]); kind=record[2]
            result=self.engine.run(kind, asset_path=self.asset_path(record[1]) if self.asset_path else None, params=request, emit=lambda *x:self.emit(jid,*x))
            with self.db.connect() as c:
                project = c.execute("SELECT source_asset_id,current_revision FROM projects WHERE id=?", (record[1],)).fetchone()
                bound_revision = request.get("revision")
                bound_asset = request.get("asset_id")
                rev = c.execute("SELECT ttml_path FROM revisions WHERE id=? AND project_id=?", (bound_revision, record[1])).fetchone()
                if not rev:
                    raise RuntimeError("bound revision disappeared")
                with open(rev[0], "rb") as source:
                    revision_hash = hashlib.sha256(source.read()).hexdigest()
            result["binding"] = {"project_id": record[1], "asset_id": bound_asset,
                                 "revision": bound_revision,
                                 "revision_sha256": revision_hash}
            with self.db.transaction() as c:
                t=now(); c.execute("UPDATE jobs SET status='succeeded',result_json=?,engine_json=?,updated_at=?,finished_at=?,state_version=state_version+1 WHERE id=? AND status IN ('running','cancel_requested')",(json.dumps(result,ensure_ascii=False),json.dumps(result.get("engine",{})),t,t,jid)); self._event(c,jid,"state","succeeded",1,1,"任务完成")
        except EngineUnavailable as exc: self._finish_error(jid,"capability_unavailable",str(exc))
        except Exception as exc:
            logger.exception("job %s failed", jid)
            self._finish_error(jid, "engine_error", "Lazulite engine failed; inspect server logs")

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
        return {"schema_version":"studio-job-v1","id":row[0],"project_id":row[1],"kind":row[2],"status":row[3],"request":json.loads(row[4]),"result_available":row[5] is not None,"error":json.loads(row[6]) if row[6] else None,"engine":json.loads(row[7]) if row[7] else None,"created_at":row[8],"updated_at":row[9],"state_version":row[13]}

    def events(self,jid,after=0):
        with self.db.connect() as c: rows=c.execute("SELECT * FROM job_events WHERE job_id=? AND seq>? ORDER BY seq",(jid,after)).fetchall()
        return [{"schema_version":"studio-job-event-v1","id":r[1],"job_id":r[0],"seq":r[1],"kind":r[2],"stage":r[3],"completed":r[4],"total":r[5],"message":r[6],"state_version":r[7],"created_at":r[8]} for r in rows]

    def result(self,jid):
        with self.db.connect() as c: row=c.execute("SELECT result_json FROM jobs WHERE id=?",(jid,)).fetchone()
        return json.loads(row[0]) if row and row[0] else None

    def close(self):
        self._pool.shutdown(wait=False, cancel_futures=False)
