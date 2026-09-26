import io
import wave

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


def test_studio_http_lifecycle(tmp_path, monkeypatch):
    monkeypatch.setattr("server.app.MAX_UPLOAD", 16 * 1024)
    settings = Settings("pw", False, "http://studio")
    client = TestClient(create_app(tmp_path, settings), base_url="https://studio")
    login = client.post(
        "/api/v1/session", json={"password": "pw"}, headers={"origin": settings.origin}
    )
    assert login.status_code == 200
    csrf = login.cookies["studio_csrf"]
    headers = {"origin": settings.origin, "x-csrf-token": csrf}
    assert (
        client.post(
            "/api/v1/assets",
            files={"file": ("x.wav", b"bad", "audio/wav")},
            headers={"origin": settings.origin},
        ).status_code
        == 403
    )
    assert (
        client.post(
            "/api/v1/assets",
            files={"file": ("x.bin", b"bad", "application/octet-stream")},
            headers=headers,
        ).status_code
        == 415
    )
    oversized = client.post(
        "/api/v1/assets",
        files={"file": ("large.wav", b"x" * (1024 * 1024 + 100), "audio/wav")},
        headers=headers,
    )
    assert oversized.status_code == 413
    chunked = client.post(
        "/api/v1/assets",
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
    uploaded = client.post(
        "/api/v1/assets",
        files={"file": ("tone.wav", wav_bytes(), "audio/wav")},
        headers=headers,
    )
    assert uploaded.status_code == 200
    asset = uploaded.json()
    assert set(
        (
            "schema_version",
            "id",
            "filename",
            "content_type",
            "size_bytes",
            "duration_us",
            "status",
            "asset_hash",
            "source_start_us",
            "proxy_offset_us",
        )
    ) <= set(asset)
    assert asset["schema_version"] == "studio-asset-v1" and asset["status"] == "ready"
    created = client.post(
        "/api/v1/projects",
        json={"name": "Tone", "source_asset_id": asset["id"]},
        headers={**headers, "idempotency-key": "create-tone"},
    )
    assert created.status_code == 200
    project = created.json()
    pid = project["id"]
    retry = client.post(
        "/api/v1/projects",
        json={"name": "Tone", "source_asset_id": asset["id"]},
        headers={**headers, "idempotency-key": "create-tone"},
    )
    assert retry.status_code == 200 and retry.json()["id"] == pid
    assert (
        client.post(
            "/api/v1/projects",
            json={"name": "Other", "source_asset_id": asset["id"]},
            headers={**headers, "idempotency-key": "create-tone"},
        ).status_code
        == 409
    )
    for name, key in (("Two", "create-two"), ("Three", "create-three")):
        assert (
            client.post(
                "/api/v1/projects",
                json={"name": name, "source_asset_id": asset["id"]},
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
    detail = client.get(f"/api/v1/projects/{pid}").json()
    assert detail["asset"]["id"] == asset["id"]
    document = client.get(f"/api/v1/projects/{pid}/document")
    revision = document.json()["revision"]
    assert revision and document.headers["etag"] == f'"{revision}"'
    lyrics = client.get(f"/api/v1/projects/{pid}/lyrics")
    assert lyrics.status_code == 200 and lyrics.headers["etag"] == f'"{revision}"'
    audio = client.get(f"/api/v1/projects/{pid}/audio", headers={"range": "bytes=0-9"})
    assert audio.status_code == 206 and len(audio.content) == 10
    pcm = client.get(f"/api/v1/projects/{pid}/pcm?start_us=0&end_us=500000")
    assert pcm.status_code == 200 and pcm.headers["x-sample-rate"] == "48000"
    assert pcm.headers["x-channels"] == "2" and len(pcm.content) == 96_000
    assert client.get(f"/api/v1/projects/{pid}/pcm?start_us=0&end_us=5000000").status_code == 422
    assert (
        client.get(
            f"/api/v1/projects/{pid}/audio", headers={"range": "bytes=-10"}
        ).status_code
        == 206
    )
    assert (
        client.get(
            f"/api/v1/projects/{pid}/audio", headers={"range": "bytes=999999999-"}
        ).status_code
        == 416
    )
    etag = client.get(f"/api/v1/projects/{pid}/audio").headers["etag"]
    assert (
        client.get(
            f"/api/v1/projects/{pid}/audio",
            headers={"range": "bytes=0-9", "if-range": etag},
        ).status_code
        == 206
    )
    waveform = client.get(
        f"/api/v1/projects/{pid}/waveform",
        params={"level": 0, "start_us": 0, "end_us": 100000},
    ).json()
    assert (
        waveform["schema_version"] == "studio-waveform-v1"
        and waveform["asset_id"] == asset["id"]
    )
    restarted = TestClient(create_app(tmp_path, settings), base_url="https://studio")
    restarted.cookies.update(client.cookies)
    assert (
        restarted.get(f"/api/v1/projects/{pid}").json()["asset"]["asset_hash"]
        == asset["asset_hash"]
    )
    old_cookies = dict(client.cookies)
    assert client.delete("/api/v1/session", headers=headers).status_code == 200
    logged_out = TestClient(create_app(tmp_path, settings), base_url="https://studio")
    logged_out.cookies.update(old_cookies)
    assert logged_out.get("/api/v1/projects").status_code == 401


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
