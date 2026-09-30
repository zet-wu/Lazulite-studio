import subprocess
import time

from fastapi.testclient import TestClient

from server.app import create_app
from server.auth import Settings


def _headers(client, settings):
    login = client.post("/api/v1/session", json={"password": "pw"}, headers={"origin": settings.origin})
    assert login.status_code == 200
    return {"origin": settings.origin, "x-csrf-token": login.cookies["studio_csrf"]}


def _m4a(path):
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-c:a", "aac", str(path)], check=True)


def _project(client, headers, tmp_path):
    media = tmp_path / "tone.m4a"
    _m4a(media)
    uploaded = client.post("/api/v1/assets", files={"file": ("tone.m4a", media.read_bytes(), "audio/mp4")}, headers=headers)
    assert uploaded.status_code == 200
    made = client.post("/api/v1/projects", json={"name": "Tone", "source_asset_id": uploaded.json()["id"]}, headers={**headers, "idempotency-key": "project"})
    assert made.status_code == 200
    return made.json()["id"], uploaded.json()["id"]


def _save(client, headers, pid, revision, text):
    body = {"schema_version": "studio-document-v1", "project_id": pid, "revision": revision,
            "document": {"schema_version": "studio-document-content-v1", "ttml": text}}
    out = client.put(f"/api/v1/projects/{pid}/document", json=body, headers={**headers, "if-match": f'"{revision}"', "idempotency-key": revision + "-save"})
    assert out.status_code == 200
    return out.json()["revision"]


def _wait(client, job):
    for _ in range(100):
        value = client.get(f"/api/v1/jobs/{job}").json()
        if value["status"] in {"succeeded", "failed"}:
            return value
        time.sleep(0.02)
    raise AssertionError("publish job did not finish")


def test_publish_real_http_old_revision_idempotency_and_missing_file(tmp_path):
    settings = Settings("pw", False, "http://studio")
    client = TestClient(create_app(tmp_path, settings), base_url="https://studio")
    headers = _headers(client, settings)
    pid, asset = _project(client, headers, tmp_path)
    empty = client.get(f"/api/v1/projects/{pid}/document").json()["revision"]
    first = _save(client, headers, pid, empty, '<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttp="http://www.w3.org/ns/ttml#parameter" ttp:timeBase="media"><body timeContainer="par"><p begin="0s" end="1s">hello</p></body></tt>')
    created = client.post(f"/api/v1/projects/{pid}/publish", json={"revision": first, "asset_id": asset, "lrc_kind":"lrc", "lrc_text":"[00:00.000]hello\n[00:01.000]\n"}, headers={**headers, "idempotency-key": "pub-1"})
    assert created.status_code == 202
    retry = client.post(f"/api/v1/projects/{pid}/publish", json={"revision": first, "asset_id": asset, "lrc_kind":"lrc", "lrc_text":"[00:00.000]hello\n[00:01.000]\n"}, headers={**headers, "idempotency-key": "pub-1"})
    assert retry.status_code == 202 and retry.json()["id"] == created.json()["id"]
    done = _wait(client, created.json()["id"])
    assert done["status"] == "succeeded"
    second = _save(client, headers, pid, first, '<tt xmlns="http://www.w3.org/ns/ttml"><body><p begin="0s" end="1s">updated</p></body></tt>')
    assert second != first
    exports = client.get(f"/api/v1/projects/{pid}/exports").json()["items"]
    assert exports[0]["report"]["passed"] is True
    assert exports[0]["stale"] is True
    restarted = TestClient(create_app(tmp_path, settings), base_url="https://studio")
    restarted.cookies.update(client.cookies)
    assert restarted.get(f"/api/v1/projects/{pid}/exports").json()["items"][0]["id"] == done["id"]
    download = client.get(f"/api/v1/projects/{pid}/exports/{done['id']}/download")
    assert download.status_code == 200 and (b"ftyp" in download.content[:32])
    path = next((tmp_path / "exports").glob("*"))
    path.unlink()
    assert client.get(f"/api/v1/projects/{pid}/exports").json()["items"][0]["status"] == "unavailable"
    assert client.get(f"/api/v1/projects/{pid}/exports/{done['id']}/download").status_code == 410


def test_publish_http_validation_and_download_auth_gate(tmp_path):
    settings = Settings("pw", False, "http://studio")
    client = TestClient(create_app(tmp_path, settings), base_url="https://studio")
    headers = _headers(client, settings)
    pid, asset = _project(client, headers, tmp_path)
    revision = client.get(f"/api/v1/projects/{pid}/document").json()["revision"]
    bad = _save(client, headers, pid, revision, '<tt xmlns="http://www.w3.org/ns/ttml" xmlns:studio="urn:lazulite:studio:draft"><body><p begin="0s" end="1s"><span studio:null="begin end">x</span></p></body></tt>')
    assert client.post(f"/api/v1/projects/{pid}/publish", json={"revision": bad, "asset_id": asset, "lrc_kind":"lrc", "lrc_text":"[00:00.000]hello\n[00:01.000]\n"}, headers={**headers, "idempotency-key": "bad"}).status_code == 202
    failed = _wait(client, client.get(f"/api/v1/projects/{pid}/exports").json()["items"][0]["id"])
    assert failed["status"] == "failed" and failed["error"]["code"] == "publish_failed"
    assert client.get(f"/api/v1/projects/{pid}/exports/{failed['id']}/download").status_code == 409
    unauthenticated = TestClient(create_app(tmp_path, settings), base_url="https://studio")
    assert unauthenticated.get(f"/api/v1/projects/{pid}/exports/{failed['id']}/download").status_code == 401
    assert client.post(f"/api/v1/projects/{pid}/publish", json={"revision": "missing", "asset_id": asset, "lrc_kind":"lrc", "lrc_text":"[00:00.000]hello\n[00:01.000]\n"}, headers=headers).status_code == 422
    assert client.post(f"/api/v1/projects/{pid}/publish", json={"revision": bad, "asset_id": "other"}, headers=headers).status_code == 422
    clock = _save(client, headers, pid, bad, '<tt xmlns="http://www.w3.org/ns/ttml"><body><p begin="0s" end="1s" dur="1s">x</p></body></tt>')
    clock_job = client.post(f"/api/v1/projects/{pid}/publish", json={"revision": clock, "asset_id": asset, "lrc_kind":"lrc", "lrc_text":"[00:00.000]hello\n[00:01.000]\n"}, headers={**headers, "idempotency-key": "clock"}).json()["id"]
    assert _wait(client, clock_job)["error"]["code"] == "publish_failed"
