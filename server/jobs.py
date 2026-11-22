from __future__ import annotations
import json, threading, uuid, logging
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

from .db import Database
from .engine import EngineUnavailable
from .reading import ReadingUnavailable
from .vocals import VocalCancelled
from .runtime_devices import DeviceFailure, RuntimeDevices

logger = logging.getLogger(__name__)

def now(): return datetime.now(timezone.utc).isoformat()

class JobService:
    """Durable single-slot executor. Current state and latest stage are committed for polling."""
    def __init__(self, db: Database, *, asset_path=None, vocal_runner=None, alignment_runner=None, devices=None, event_hub=None):
        self.db, self.asset_path = db, asset_path
        from .revisions import RevisionStore
        self.revisions = RevisionStore(db, db.paths.root / 'projects', event_hub=event_hub)
        self.vocal_runner = vocal_runner
        self.alignment_runner = alignment_runner
        self.devices = devices or RuntimeDevices()
        self.event_hub = event_hub
        self._closing = False
        self._closed = False
        self._cancel_events: dict[str, threading.Event] = {}
        self._lock = threading.RLock(); self._pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="studio-job")
        with db.transaction() as c:
            rows = c.execute("SELECT id FROM jobs WHERE status IN ('queued','running','cancel_requested')").fetchall()
            for row in rows:
                t = now(); c.execute("UPDATE jobs SET status='interrupted',updated_at=?,finished_at=? WHERE id=?", (t,t,row[0]))

        self.revisions.recover()

    def _publish(self, project_id: str, job_id: str, kind: str, status: str, stage: str | None = None) -> None:
        if self.event_hub is not None:
            self.event_hub.publish(project_id, "job_updated", job_id=job_id, kind=kind, status=status, stage=stage)

    def create(self, project_id, kind, request, *, idem_key=None, subject="local"):
        if kind not in {'vocal', 'alignment'}:
            raise ValueError("不支持此任务类别")
        digest=json.dumps([subject, kind, request],sort_keys=True,separators=(",",":"),ensure_ascii=False)
        need_devices = not (request.get('upload_id') or request.get('retry_analysis_id') or (kind == 'vocal' and request.get('_reuse_vocal_id')))
        skip_vocal = bool(request.get('_reuse_vocal_id') or request.get('_has_vocal'))
        devices_snapshot = self.devices.snapshot(kind, cpu_retry=request.get('cpu_retry', False), skip_vocal=skip_vocal) if need_devices else {}
        with self._lock, self.db.transaction() as c:
            if self._closing: raise ValueError("服务正在停止，不再接受任务")
            if idem_key:
                old=c.execute("SELECT request_hash,job_id FROM job_idempotency WHERE project_id=? AND idem_key=?",(project_id,idem_key)).fetchone()
                if old:
                    if old[0]!=digest: raise ValueError("idempotency key was used for another request")
                    return self.get(old[1])
            source = c.execute('SELECT source_asset_id FROM projects WHERE id=?', (project_id,)).fetchone()
            if not source or source[0] != request.get('asset_id'): raise ValueError('源音频已改变，请重新发起任务')
            if kind == 'alignment':
                revision = request.get('revision')
                if not c.execute('SELECT 1 FROM revisions WHERE id=? AND project_id=?', (revision, project_id)).fetchone():
                    raise ValueError('项目输入版本已不可用，请重新保存后发起任务')
            if kind == 'alignment' or request.get('cpu_retry'):
                revision = request.get('revision', request.get('bound_revision'))
                current = c.execute('SELECT current_revision FROM projects WHERE id=?', (project_id,)).fetchone()
                if not current or current[0] != revision: raise ValueError('项目版本已改变，请重新发起任务')
            active = c.execute("SELECT id,kind FROM jobs WHERE project_id=? AND kind IN ('vocal','alignment') AND status IN ('queued','running','cancel_requested')", (project_id,)).fetchone()
            if active and (kind != 'vocal' or active['kind'] != 'vocal'): raise ValueError('已有音频处理运行，请等待完成或取消')
            if active:
                if request.get('upload_id'): raise ValueError('已有音频处理运行，请等待完成或取消')
                return self.get(active[0])
            request['devices'] = devices_snapshot
            if kind == 'vocal' and request['devices']: request['device'] = request['devices']['vocal']['actual']
            if request.get('_vocal_model', {}).get('type') == 'bs-karaoke' and request['devices']['vocal']['actual'] not in {'cpu','cuda'}:
                raise ValueError('BS Karaoke 当前支持 CPU 或 NVIDIA GPU，请选择 CPU 或其他模型')
            jid=uuid.uuid4().hex; t=now()
            if request.get('_upload_path'):
                import shutil
                pinned = self.vocal_runner.root / project_id / 'vocals' / jid
                pinned.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(request['_upload_path'], pinned / 'uploaded')
                request = {**request, '_upload_path': str(pinned / 'uploaded')}

            c.execute("INSERT INTO jobs(id,project_id,kind,status,request_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",(jid,project_id,kind,"queued",json.dumps(request, ensure_ascii=False),t,t))

            if idem_key: c.execute("INSERT INTO job_idempotency VALUES(?,?,?,?)",(project_id,idem_key,digest,jid))
            self._cancel_events[jid] = threading.Event()
        self._publish(project_id, jid, kind, "queued", None)
        with self._lock:
            if not self._closing: self._pool.submit(self._run,jid)
        return self.get(jid)

    def _run(self,jid):
        started_row = None
        with self._lock, self.db.transaction() as c:
            if self._closing:
                self._cancel_events.pop(jid, None)
                return
            row=c.execute("SELECT * FROM jobs WHERE id=?",(jid,)).fetchone()
            if not row or row[3] != "queued":
                self._cancel_events.pop(jid, None)
                return
            t=now(); c.execute("UPDATE jobs SET status='running',started_at=?,updated_at=? WHERE id=?",(t,t,jid))
            started_row = row
            cancel_event = self._cancel_events.setdefault(jid, threading.Event())
        if started_row is not None:
            self._publish(started_row[1], jid, started_row[2], "running", started_row["stage"])
        record = None
        kind = None
        result = None
        try:
            with self.db.connect() as c: record=c.execute("SELECT * FROM jobs WHERE id=?",(jid,)).fetchone()
            if not record: return
            request=json.loads(record[4]); kind=record[2]
            if kind in {'vocal', 'alignment'}:
                self.emit(jid, 'stage', 'preparing')
                for snapshot in request['devices'].values():
                    if not snapshot.get('runtime_ok', True): raise EngineUnavailable(snapshot['reason'])
                if cancel_event.is_set(): raise VocalCancelled()
            if kind == "vocal":
                result = self.vocal_runner.run(record[1], self.asset_path(record[1]), request, jid,
                    lambda *x: self.emit(jid, *x), cancel_event.is_set)
            elif kind == "alignment":
                result = self.alignment_runner.run(record[1], self.asset_path(record[1]), request, jid,
                    lambda *x: self.emit(jid, *x), cancel_event.is_set)
            else:
                raise ValueError("不支持此任务类别")
            if kind == "alignment":
                with self.db.connect() as c:
                    project = c.execute("SELECT source_asset_id,current_revision FROM projects WHERE id=?", (record[1],)).fetchone()
                    bound_revision = request.get("revision")
                    bound_asset = request.get("asset_id")
                    if project is None or project["current_revision"] != bound_revision or project["source_asset_id"] != bound_asset:
                        raise ValueError("项目版本或源音频已改变，请重新运行")
                    if not c.execute("SELECT 1 FROM revisions WHERE id=? AND project_id=?", (bound_revision, record[1])).fetchone():
                        raise RuntimeError("bound revision disappeared")
                result["binding"] = {"project_id": record[1], "asset_id": bound_asset,
                                     "revision": bound_revision}
            with self._lock, self.db.transaction() as c:
                cancelled = c.execute('SELECT cancel_requested, stage FROM jobs WHERE id=?', (jid,)).fetchone()
                if cancelled[0]:
                    t = now()
                    c.execute("UPDATE jobs SET status='cancelled',updated_at=?,finished_at=? WHERE id=?", (t,t,jid))
                    final_status = "cancelled"
                    final_stage = cancelled[1]
                else:
                    t=now(); c.execute("UPDATE jobs SET status='succeeded',result_json=?,engine_json=?,updated_at=?,finished_at=? WHERE id=? AND status IN ('running','cancel_requested')",(json.dumps(result,ensure_ascii=False),json.dumps(result.get("engine",{})),t,t,jid))
                    final_status = "succeeded"
                    final_stage = cancelled[1]
            self._publish(record[1], jid, kind, final_status, final_stage)
            if final_status == "cancelled":
                return
        except DeviceFailure as exc:
            self._finish_error(jid, 'device_failed', str(exc), stage=exc.stage, cpu_retry=True)
        except VocalCancelled:
            cancelled_row = None
            with self.db.transaction() as c:
                t = now()
                c.execute("UPDATE jobs SET status='cancelled',updated_at=?,finished_at=? WHERE id=?", (t,t,jid))
                cancelled_row = c.execute("SELECT project_id, kind, stage FROM jobs WHERE id=?", (jid,)).fetchone()
            if cancelled_row:
                self._publish(cancelled_row[0], jid, cancelled_row[1], "cancelled", cancelled_row[2])

        except (EngineUnavailable, ReadingUnavailable) as exc: self._finish_error(jid,"capability_unavailable",str(exc))
        except Exception as exc:
            logger.warning("job %s failed (%s)", jid, type(exc).__name__)
            self._finish_error(jid, "engine_error", str(exc) if kind == "alignment" or kind == "vocal" and isinstance(exc, ValueError) else "Lazulite engine failed; inspect server logs")

        finally:
            with self._lock:
                self._cancel_events.pop(jid, None)
            if record and record[2] in {'vocal','alignment'}:
                try: self.vocal_runner.clean_unregistered(record[1], jid)
                except OSError: logger.warning('未注册人声文件清理待重试：%s', jid)

            if record:
                self.revisions.collect(record[1])

    def _finish_error(self,jid,code,message, **extra):
        updated = None
        with self.db.transaction() as c:
            state = c.execute('SELECT cancel_requested, project_id, kind, stage FROM jobs WHERE id=?', (jid,)).fetchone()
            if state and state[0]:
                t = now()
                c.execute("UPDATE jobs SET status='cancelled',updated_at=?,finished_at=? WHERE id=?", (t,t,jid))
                updated = (state[1], state[2], "cancelled", state[3])
            else:
                t=now(); c.execute("UPDATE jobs SET status='failed',error_json=?,updated_at=?,finished_at=? WHERE id=? AND status IN ('running','cancel_requested')",(json.dumps({"code":code,"message":message, **extra}),t,t,jid))
                if state:
                    updated = (state[1], state[2], "failed", state[3])
        if updated:
            self._publish(updated[0], jid, updated[1], updated[2], updated[3])

    def emit(self,jid,kind,stage):
        if kind == 'stage':
            row = None
            with self.db.transaction() as c:
                cur = c.execute("UPDATE jobs SET stage=?,updated_at=? WHERE id=? AND status IN ('running','cancel_requested')", (stage, now(), jid))
                if cur.rowcount:
                    row = c.execute("SELECT project_id, kind, status, stage FROM jobs WHERE id=?", (jid,)).fetchone()
            if row:
                self._publish(row[0], jid, row[1], row[2], row[3])

    def cancel(self,jid):
        with self._lock, self.db.transaction() as c:
            row=c.execute("SELECT status,project_id,kind,stage FROM jobs WHERE id=?",(jid,)).fetchone()
            if not row: return None
            if row[0]=="queued": status="cancelled"
            elif row[0]=="running": status="cancel_requested"
            else: return self.get(jid)
            t=now(); c.execute("UPDATE jobs SET status=?,cancel_requested=1,updated_at=?,finished_at=? WHERE id=?",(status,t,t if status=="cancelled" else None,jid))
            if ev := self._cancel_events.get(jid):
                ev.set()
        self._publish(row[1], jid, row[2], status, row[3])
        if status == "cancelled":
            with self._lock:
                self._cancel_events.pop(jid, None)
            if self.vocal_runner: self.vocal_runner.clean_unregistered(row[1], jid)
            self.revisions.collect(row[1])
        return self.get(jid)

    def acknowledge(self, jid: str, state: str):
        if state not in {'applied', 'dismissed'}:
            raise ValueError('无效的任务确认状态')
        with self.db.transaction() as c:
            row = c.execute("SELECT project_id FROM jobs WHERE id=?", (jid,)).fetchone()
            if not row:
                return None
            c.execute(
                "INSERT INTO job_acknowledgements(job_id, project_id, state, updated_at) VALUES(?,?,?,?) "
                "ON CONFLICT(job_id) DO UPDATE SET state=excluded.state, updated_at=excluded.updated_at",
                (jid, row[0], state, now()),
            )
        return self.get(jid)

    def get(self,jid):
        with self.db.connect() as c:
            row=c.execute("SELECT j.*, a.state AS ack_state FROM jobs j LEFT JOIN job_acknowledgements a ON a.job_id=j.id WHERE j.id=?",(jid,)).fetchone()
        return self._job(row) if row else None

    def list(self, project_id, limit):
        with self.db.connect() as c:
            rows = c.execute("SELECT j.*, a.state AS ack_state FROM jobs j LEFT JOIN job_acknowledgements a ON a.job_id=j.id WHERE j.project_id=? ORDER BY j.created_at DESC LIMIT ?", (project_id, limit)).fetchall()
        return [self._job(row) for row in rows]

    @staticmethod
    def _job(row):
        return {
            "stage": row["stage"],
            "schema_version":"studio-job-v1",
            "id":row[0],
            "project_id":row[1],
            "kind":row[2],
            "status":row[3],
            "request":json.loads(row[4]),
            "result_available":row[5] is not None,
            "error":json.loads(row[6]) if row[6] else None,
            "engine":json.loads(row[7]) if row[7] else None,
            "created_at":row[8],
            "updated_at":row[9],
            "acknowledged_state": row["ack_state"] if "ack_state" in row.keys() else None,
        }

    def result(self,jid):
        with self.db.connect() as c: row=c.execute("SELECT result_json FROM jobs WHERE id=?",(jid,)).fetchone()
        return json.loads(row[0]) if row and row[0] else None

    def begin_stop(self):
        with self._lock:
            if self._closing: return
            self._closing = True
            for ev in self._cancel_events.values():
                ev.set()
            with self.db.transaction() as c:
                for row in c.execute("SELECT id,status FROM jobs WHERE status IN ('queued','running','cancel_requested')").fetchall():
                    state = 'cancelled' if row['status'] == 'queued' else 'cancel_requested'
                    t = now()
                    c.execute('UPDATE jobs SET status=?,cancel_requested=1,updated_at=?,finished_at=? WHERE id=?', (state,t,t if state == 'cancelled' else None,row['id']))


    def close(self):
        self.begin_stop()
        with self._lock:
            if self._closed: return
            self._closed = True
        import time
        deadline = time.monotonic() + 1.5
        while time.monotonic() < deadline:
            with self.db.connect() as c:
                if not c.execute("SELECT 1 FROM jobs WHERE status='cancel_requested'").fetchone(): break
            time.sleep(.05)
        if self.vocal_runner is not None: self.vocal_runner.close()
        if self.alignment_runner is not None: self.alignment_runner.close()
        from .process_supervisor import close_all
        close_all()
        self._pool.shutdown(wait=True, cancel_futures=True)
        with self.db.connect() as c:
            projects = c.execute('SELECT id FROM projects').fetchall()
        for project in projects: self.revisions.collect(project[0])
