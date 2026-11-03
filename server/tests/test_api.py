import io
import wave

import pytest

from fastapi.testclient import TestClient

from server.app import create_app
from server.auth import Settings


def wav_bytes() -> bytes:
    out = io.BytesIO()
    with wave.open(out, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(8000)
        wav.writeframes((b"\x00\x00" * 8000))
    return out.getvalue()


@pytest.fixture
def authenticated_client(tmp_path):
    settings = Settings("pw", False)
    client = TestClient(create_app(tmp_path, settings), base_url="https://studio")
    login = client.post(
        "/api/v1/session", json={"password": "pw"}, headers={"origin": "http://studio"}
    )
    assert login.status_code == 200
    csrf = login.cookies["studio_csrf"]
    headers = {"origin": "http://studio", "x-csrf-token": csrf}
    yield client, settings, headers
    client.close()


def test_upload_boundaries_and_session_revocation(tmp_path, monkeypatch, authenticated_client):
    client, settings, headers = authenticated_client
    assert (
        client.post(
            "/api/v1/uploads",
            files={"file": ("x.wav", b"bad", "audio/wav")},
            headers={"origin": "http://studio"},
        ).status_code
        == 403
    )
    assert (
        client.post(
            "/api/v1/uploads",
            files={"file": ("x.bin", b"bad", "application/octet-stream")},
            headers=headers,
        ).status_code
        == 415
    )
    old_cookies = dict(client.cookies)
    assert client.delete("/api/v1/session", headers=headers).status_code == 200
    logged_out = TestClient(create_app(tmp_path, settings), base_url="https://studio")
    logged_out.cookies.update(old_cookies)
    assert logged_out.get("/api/v1/projects").status_code == 401



def test_project_creation_idempotency_and_pagination(authenticated_client):
    client, settings, headers = authenticated_client
    uploaded = client.post(
        "/api/v1/uploads",
        files={"file": ("tone.wav", wav_bytes(), "audio/wav")},
        headers=headers,
    )
    assert uploaded.status_code == 200
    asset = uploaded.json()
    created = client.post(
        "/api/v1/projects",
        json={"name": "Tone", "upload_id": asset["id"]},
        headers={**headers, "idempotency-key": "create-tone"},
    )
    assert created.status_code == 200
    project = created.json()
    pid = project["id"]
    retry = client.post(
        "/api/v1/projects",
        json={"name": "Tone", "upload_id": asset["id"]},
        headers={**headers, "idempotency-key": "create-tone"},
    )
    assert retry.status_code == 200 and retry.json()["id"] == pid
    assert (
        client.post(
            "/api/v1/projects",
            json={"name": "Other", "upload_id": asset["id"]},
            headers={**headers, "idempotency-key": "create-tone"},
        ).status_code
        == 409
    )
    for name, key in (("Two", "create-two"), ("Three", "create-three")):
        assert (
            client.post(
                "/api/v1/projects",
                json={"name": name},
                headers={**headers, "idempotency-key": key},
            ).status_code
            == 200
        )
    cursor = None
    seen = []
    while True:
        params = {"limit": 1, **({"cursor": cursor} if cursor else {})}
        page = client.get("/api/v1/projects", params=params).json()
        seen.extend(item["id"] for item in page["items"])
        cursor = page["next_cursor"]
        if not cursor:
            break
    assert len(seen) == 3 and len(set(seen)) == 3


def test_studio_http_lifecycle(tmp_path, authenticated_client):
    client, settings, headers = authenticated_client
    from server.tests.test_publish import _project, _save, _wait
    pid, asset_id = _project(client, headers, tmp_path)
    revision = client.get(f"/api/v1/projects/{pid}/document").json()["revision"]
    revision = _save(client, headers, pid, revision,
                     '<tt xmlns="http://www.w3.org/ns/ttml"><body><p begin="0s" end="1s">hello</p></body></tt>')
    response = client.post(
        f"/api/v1/projects/{pid}/publish",
        json={"revision": revision, "asset_id": asset_id,
              "lrc_kind": "lrc", "lrc_text": "[00:00.000]hello\n"},
        headers=headers,
    )
    assert response.status_code == 202
    job_id = response.json()["id"]
    assert _wait(client, job_id)["status"] == "succeeded"
    assert client.get(f"/api/v1/jobs/{job_id}/result").status_code == 200


def test_trusted_gateway_access(tmp_path):
    app = create_app(tmp_path, Settings(None, True))
    client = TestClient(app, base_url="https://gateway")
    assert client.get("/api/v1/projects").status_code == 200



def test_asset_exposes_source_and_proxy_durations_separately(tmp_path, authenticated_client):
    import json
    from server.db import Database
    client, _, headers = authenticated_client
    uploaded = client.post('/api/v1/uploads', files={'file': ('tone.wav', wav_bytes(), 'audio/wav')}, headers=headers)
    assert uploaded.status_code == 200, uploaded.text
    asset = uploaded.json()
    assert asset['source_duration_ms'] == 1000
    created = client.post('/api/v1/projects', json={'name': 'Different durations', 'upload_id': asset['id']}, headers={**headers, 'idempotency-key': 'duration-project'})
    assert created.status_code == 200, created.text
    pid = created.json()['id']
    db = Database(tmp_path / 'studio.sqlite3')
    with db.transaction() as conn:
        row = conn.execute('SELECT metadata FROM assets WHERE id=?', (asset['id'],)).fetchone()
        metadata = json.loads(row[0])
        metadata['proxy_duration_ms'] = 1022
        conn.execute('UPDATE assets SET duration_ms=?,metadata=? WHERE id=?', (1021, json.dumps(metadata), asset['id']))
    current = client.get(f'/api/v1/projects/{pid}').json()['asset']
    assert current['source_duration_ms'] == 1021
    assert current['duration_ms'] == 1022
    with db.transaction() as conn:
        conn.execute('UPDATE assets SET duration_ms=NULL WHERE id=?', (asset['id'],))
    current = client.get(f'/api/v1/projects/{pid}').json()['asset']
    assert current['source_duration_ms'] is None
    assert current['duration_ms'] == 1022
