import asyncio
import json
import socket
import threading
import time
from pathlib import Path

import httpx
import uvicorn
from fastapi.testclient import TestClient

from server.app import create_app
from server.auth import Settings
from server.events import ProjectEventHub
from server.project_document import initial_project
from server.revisions import INITIAL_TTML


def test_event_hub_delivers_and_closes():
    async def run():
        hub = ProjectEventHub(max_queue_size=2)
        received = []

        async def reader():
            async for event in hub.subscribe("p1"):
                received.append(event)

        task = asyncio.create_task(reader())
        await asyncio.sleep(0.02)
        hub.publish("p1", "revision_changed", revision="r1", source_asset_id=None)
        hub.publish("p2", "revision_changed", revision="other", source_asset_id=None)
        hub.publish("p1", "job_updated", job_id="j1", kind="vocal", status="running", stage="separating")
        await asyncio.sleep(0.02)
        hub.close()
        await asyncio.wait_for(task, timeout=1.0)
        assert [e["type"] for e in received] == ["revision_changed", "job_updated"]
        assert received[0]["revision"] == "r1"
        assert received[1]["stage"] == "separating"

    asyncio.run(run())


def test_job_acknowledge_and_deletion(tmp_path: Path):
    app = create_app(tmp_path / "data", Settings(mode="local"))
    with TestClient(app) as client:
        project = client.post("/api/v1/projects", json={"name": "Ack Test"}).json()
        pid = project["id"]

        job_service = app.state.jobs
        with job_service.db.transaction() as c:
            c.execute(
                "INSERT INTO jobs(id,project_id,kind,status,request_json,result_json,created_at,updated_at,finished_at) VALUES(?,?,?,?,?,?,?,?,?)",
                ("j-ack", pid, "alignment", "succeeded", "{}", "{}", "2026-11-22T00:00:00Z", "2026-11-22T00:00:00Z", "2026-11-22T00:00:01Z"),
            )

        listed = client.get(f"/api/v1/projects/{pid}/jobs").json()["items"]
        assert listed[0]["acknowledged_state"] is None

        ack = client.post("/api/v1/jobs/j-ack/acknowledge", json={"state": "applied"})
        assert ack.status_code == 200
        assert ack.json()["acknowledged_state"] == "applied"

        bad = client.post("/api/v1/jobs/j-ack/acknowledge", json={"state": "unknown"})
        assert bad.status_code == 422

        deleted = client.delete(f"/api/v1/projects/{pid}")
        assert deleted.status_code == 200


def test_live_sse_streams_revision_and_job_events_and_closes_on_shutdown(tmp_path: Path):
    app = create_app(tmp_path / "data", Settings(mode="local"))
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
    sock.close()

    config = uvicorn.Config(app, host="127.0.0.1", port=port, log_level="error", timeout_graceful_shutdown=2)
    server = uvicorn.Server(config)
    server_thread = threading.Thread(target=server.run, daemon=True)
    server_thread.start()

    base = f"http://127.0.0.1:{port}"
    try:
        for _ in range(50):
            if server.started:
                break
            time.sleep(0.05)
        assert server.started

        with httpx.Client(base_url=base, timeout=5.0) as client:
            pid = client.post("/api/v1/projects", json={"name": "Live SSE"}).json()["id"]
            env = client.get(f"/api/v1/projects/{pid}/document").json()

            events: list[dict] = []
            ready = threading.Event()

            def listen():
                with httpx.Client(base_url=base, timeout=5.0) as sse_client:
                    with sse_client.stream("GET", f"/api/v1/projects/{pid}/events") as stream:
                        assert stream.status_code == 200
                        for line in stream.iter_lines():
                            if line == ": connected":
                                ready.set()
                            elif line.startswith("data:"):
                                events.append(json.loads(line.removeprefix("data:").strip()))
                                if len(events) >= 2:
                                    break

            listener = threading.Thread(target=listen, daemon=True)
            listener.start()
            assert ready.wait(timeout=3.0)

            snapshot = initial_project(INITIAL_TTML)
            put_resp = client.put(
                f"/api/v1/projects/{pid}/document",
                headers={"If-Match": f'"{env["revision"]}"', "Idempotency-Key": "sse-idem-1"},
                json={
                    "schema_version": "studio-document-v9",
                    "project_id": pid,
                    "revision": env["revision"],
                    "document": snapshot,
                },
            )
            assert put_resp.status_code == 200
            new_rev = put_resp.json()["revision"]

            app.state.event_hub.publish(pid, "job_updated", job_id="j-sse", kind="alignment", status="running", stage="decode")

            listener.join(timeout=3.0)
            assert not listener.is_alive()
            assert events[0] == {
                "type": "revision_changed",
                "project_id": pid,
                "revision": new_rev,
                "source_asset_id": None,
            }
            assert events[1] == {
                "type": "job_updated",
                "project_id": pid,
                "job_id": "j-sse",
                "kind": "alignment",
                "status": "running",
                "stage": "decode",
            }
    finally:
        server.should_exit = True
        server_thread.join(timeout=3.0)
        assert not server_thread.is_alive()


def test_job_status_exposes_model_identity_and_reuse_without_private_paths(tmp_path):
    app = create_app(tmp_path / 'data', Settings(mode='local'))
    with TestClient(app) as client:
        pid = client.post('/api/v1/projects', json={'name':'model status'}).json()['id']
        request = {'_model':{'id':'a','name':'align','type':'ctc','path':'/private/model'},
                   '_vocal_model':{'id':'v','name':'voice','config':{'weights':'/private/weights'}},
                   '_reuse_vocal_id':'v', 'devices':{'alignment':{'actual':'cpu'}}}
        with app.state.jobs.db.transaction() as c:
            c.execute("INSERT INTO jobs(id,project_id,kind,status,request_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
                      ('model-job',pid,'alignment','succeeded',json.dumps(request),'0','0'))
        job = client.get('/api/v1/jobs/model-job').json()
        assert job['request']['reused_vocal'] is True
        assert job['request']['model'] == {'alignment':{'id':'a','name':'align','type':'ctc'},'vocal':{'id':'v','name':'voice'}}
        assert not any(key.startswith('_') for key in job['request'])
        assert '/private/' not in json.dumps(job['request'])
