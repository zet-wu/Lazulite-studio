import json
from server.project_document import initial_project
import time
import threading
from fastapi.testclient import TestClient

from server.db import Database
from server.jobs import JobService
from server.app import create_app


class FakeEngine:
    def run(self, pid, request):
        return {"kind": "publish", "engine": {"name": "fake", "build": "test"}, "items": []}

class BlockingEngine(FakeEngine):
    started = threading.Event()
    release = threading.Event()
    def run(self, pid, request):
        self.started.set()
        self.release.wait(2)
        return super().run(pid, request)


def wait_for(service, job_id):
    for _ in range(100):
        value = service.get(job_id)
        if value["status"] in {"succeeded", "failed", "cancelled", "interrupted"}:
            return value
        time.sleep(0.01)
    raise AssertionError("job did not reach a terminal state")


def seed_project(db, root=None):
    with db.transaction() as conn:
        conn.execute("INSERT INTO assets VALUES(?,?,?,?,?,?,?,?,?,?,?,?)", ("a", "a" * 64, 1, "audio/wav", "demo.wav", 1, 1, 0, 16000, 1, "{}", "t"))
        conn.execute("INSERT INTO projects VALUES(?,?,?,?,?,?)", ("p", "demo", "a", "r", "t", "t"))
        if root is not None:
            path = root / "projects/p/revisions/r.json"
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(initial_project('<tt xmlns="http://www.w3.org/ns/ttml"><body><div/></body></tt>', 'a')))
            conn.execute("INSERT INTO revisions VALUES(?,?,?,?,?)", ("r", "p", None, db.paths.store(path), "t"))


def test_job_persists_result_and_idempotency(tmp_path):
    db = Database(tmp_path / "studio.sqlite3")
    seed_project(db, tmp_path)
    service = JobService(db, publish_runner=FakeEngine())
    request = {"title": "demo", "revision": "r", "asset_id": "a"}
    first = service.create("p", "publish", request, idem_key="request-1")
    second = service.create("p", "publish", request, idem_key="request-1")
    assert second["id"] == first["id"]
    assert wait_for(service, first["id"])["status"] == "succeeded"
    assert service.result(first["id"])["engine"]["name"] == "fake"
    service.close()


def test_restart_marks_running_interrupted(tmp_path):
    db = Database(tmp_path / "studio.sqlite3")
    seed_project(db)
    with db.transaction() as conn:
        conn.execute("UPDATE projects SET current_revision=NULL WHERE id='p'")
        conn.execute("INSERT INTO jobs(id,project_id,kind,status,request_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?)", ("j", "p", "publish", "running", "{}", "t", "t"))
    service = JobService(db, publish_runner=FakeEngine())
    assert service.get("j")["status"] == "interrupted"
    assert service.events("j")[-1]["stage"] == "interrupted"
    service.close()

def test_queued_job_can_be_cancelled_while_executor_is_blocked(tmp_path):
    db = Database(tmp_path / "studio.sqlite3")
    seed_project(db, tmp_path)
    engine = BlockingEngine()
    service = JobService(db, publish_runner=engine)
    request = {"title": "demo", "revision": "r", "asset_id": "a"}
    first = service.create("p", "publish", request)
    assert engine.started.wait(1)
    with db.transaction() as c: c.execute("INSERT INTO projects VALUES(?,?,?,?,?,?)", ("p2","demo",None,None,"t","t"))
    second = service.create("p2", "publish", request)
    assert service.cancel(second["id"])["status"] == "cancelled"
    engine.release.set()
    assert wait_for(service, first["id"])["status"] == "succeeded"
    assert service.get(second["id"])["status"] == "cancelled"
    service.close()

