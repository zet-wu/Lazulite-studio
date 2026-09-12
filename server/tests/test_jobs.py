import time
import threading
from fastapi.testclient import TestClient

from server.db import Database
from server.jobs import JobService
from server.app import create_app


class FakeEngine:
    def run(self, kind, **kwargs):
        return {"kind": kind, "engine": {"name": "fake", "build": "test"}, "items": []}

class BlockingEngine(FakeEngine):
    started = threading.Event()
    release = threading.Event()
    def run(self, kind, **kwargs):
        self.started.set()
        self.release.wait(2)
        return super().run(kind, **kwargs)


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
            path = root / "r.ttml"
            path.write_text('<tt xmlns="http://www.w3.org/ns/ttml"><body><div/></body></tt>')
            conn.execute("INSERT INTO revisions VALUES(?,?,?,?,?)", ("r", "p", None, str(path), "t"))


def test_job_persists_result_and_idempotency(tmp_path):
    db = Database(tmp_path / "studio.sqlite3")
    seed_project(db, tmp_path)
    service = JobService(db, engine=FakeEngine())
    request = {"title": "demo", "revision": "r", "asset_id": "a"}
    first = service.create("p", "search", request, idem_key="request-1")
    second = service.create("p", "search", request, idem_key="request-1")
    assert second["id"] == first["id"]
    assert wait_for(service, first["id"])["status"] == "succeeded"
    assert service.result(first["id"])["engine"]["name"] == "fake"
    service.close()


def test_restart_marks_running_interrupted(tmp_path):
    db = Database(tmp_path / "studio.sqlite3")
    seed_project(db)
    with db.transaction() as conn:
        conn.execute("UPDATE projects SET current_revision=NULL WHERE id='p'")
        conn.execute("INSERT INTO jobs(id,project_id,kind,status,request_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?)", ("j", "p", "search", "running", "{}", "t", "t"))
    service = JobService(db, engine=FakeEngine())
    assert service.get("j")["status"] == "interrupted"
    assert service.events("j")[-1]["stage"] == "interrupted"
    service.close()

def test_queued_job_can_be_cancelled_while_executor_is_blocked(tmp_path):
    db = Database(tmp_path / "studio.sqlite3")
    seed_project(db, tmp_path)
    engine = BlockingEngine()
    service = JobService(db, engine=engine)
    request = {"title": "demo", "revision": "r", "asset_id": "a"}
    first = service.create("p", "search", request)
    assert engine.started.wait(1)
    second = service.create("p", "search", request)
    assert service.cancel(second["id"])["status"] == "cancelled"
    engine.release.set()
    assert wait_for(service, first["id"])["status"] == "succeeded"
    assert service.get(second["id"])["status"] == "cancelled"
    service.close()


def test_http_job_create_snapshot_result_and_old_revision(tmp_path, monkeypatch):
    monkeypatch.setenv("STUDIO_ORIGIN", "http://studio")
    monkeypatch.setenv("STUDIO_TRUSTED_GATEWAY", "true")
    app = create_app(tmp_path, engine=FakeEngine())
    db = Database(tmp_path / "studio.sqlite3")
    seed_project(db, tmp_path)
    with TestClient(app) as client:
        headers = {"origin": "http://studio"}
        body = {"kind": "search", "params": {"revision": "r", "asset_id": "a"}}
        created = client.post("/api/v1/projects/p/jobs", json=body, headers=headers)
        assert created.status_code == 202
        job = created.json()
        snapshot = client.get("/api/v1/jobs/" + job["id"])
        assert snapshot.status_code == 200
        for _ in range(100):
            result = client.get("/api/v1/jobs/" + job["id"] + "/result")
            if result.status_code == 200:
                assert result.json()["binding"]["revision"] == "r"
                break
            time.sleep(0.01)
        else:
            raise AssertionError("job result did not become available")
        bad = client.post("/api/v1/projects/p/jobs", json={"kind": "search", "params": {"revision": "missing", "asset_id": "a"}}, headers=headers)
        assert bad.status_code == 422
