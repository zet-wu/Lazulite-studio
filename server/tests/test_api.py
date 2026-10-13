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


def multipart_chunks(size: int):
    boundary = "studio-boundary"
    yield f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="large.wav"\r\nContent-Type: audio/wav\r\n\r\n'.encode()
    for _ in range(size // 65536):
        yield b"x" * 65536
    yield b"x" * (size % 65536)
    yield f"\r\n--{boundary}--\r\n".encode()


@pytest.fixture
def authenticated_client(tmp_path):
    settings = Settings("pw", False, "http://studio")
    client = TestClient(create_app(tmp_path, settings), base_url="https://studio")
    login = client.post(
        "/api/v1/session", json={"password": "pw"}, headers={"origin": settings.origin}
    )
    assert login.status_code == 200
    csrf = login.cookies["studio_csrf"]
    headers = {"origin": settings.origin, "x-csrf-token": csrf}
    yield client, settings, headers
    client.close()


def test_upload_boundaries_and_session_revocation(tmp_path, monkeypatch, authenticated_client):
    monkeypatch.setattr("server.app.MAX_UPLOAD", 16 * 1024)
    client, settings, headers = authenticated_client
    assert (
        client.post(
            "/api/v1/uploads",
            files={"file": ("x.wav", b"bad", "audio/wav")},
            headers={"origin": settings.origin},
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
    oversized = client.post(
        "/api/v1/uploads",
        files={"file": ("large.wav", b"x" * (1024 * 1024 + 100), "audio/wav")},
        headers=headers,
    )
    assert oversized.status_code == 413
    chunked = client.post(
        "/api/v1/uploads",
        content=multipart_chunks(2 * 1024 * 1024),
        headers={
            **headers,
            "content-type": "multipart/form-data; boundary=studio-boundary",
            "x-request-id": "chunked-upload",
        },
    )
    assert (
        chunked.status_code == 413
        and chunked.json()["code"] == "upload_too_large"
        and chunked.json()["request_id"] == "chunked-upload"
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


def test_trusted_gateway_still_requires_origin(tmp_path):
    app = create_app(tmp_path, Settings(None, True, "http://gateway"))
    client = TestClient(app, base_url="https://gateway")
    assert client.get("/api/v1/projects").status_code == 200
    assert (
        client.post(
            "/api/v1/session", json={}, headers={"origin": "https://wrong"}
        ).status_code
        == 403
    )
