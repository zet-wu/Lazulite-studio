from __future__ import annotations

import tempfile
from pathlib import Path

from fastapi.testclient import TestClient
from mutagen import File

from server.app import create_app
from server.auth import Settings
from server.project_document import initial_project
from server.publishing import extract_stpp, stpp_tracks


def _headers(client, settings):
    login = client.post("/api/v1/session", json={"password": "pw"}, headers={"origin": "http://studio"})
    assert login.status_code == 200
    return {"origin": "http://studio", "x-csrf-token": login.cookies["studio_csrf"]}


def _project(client, headers, tmp_path, synthetic_audio, filename="tone.m4a", codec="aac", mime="audio/mp4"):
    ext = Path(filename).suffix.lstrip(".")
    media = synthetic_audio(tmp_path / filename, codec=codec, extension=ext)
    uploaded = client.post("/api/v1/uploads", files={"file": (filename, media.read_bytes(), mime)}, headers=headers)
    assert uploaded.status_code == 200
    made = client.post(
        "/api/v1/projects",
        json={"name": "Tone", "upload_id": uploaded.json()["id"]},
        headers={**headers, "idempotency-key": f"project-{filename}"},
    )
    assert made.status_code == 200
    return made.json()["id"], uploaded.json()["id"]


def _save(client, headers, pid, revision, text):
    body = {"schema_version": "studio-document-v9", "project_id": pid, "revision": revision, "document": initial_project(text)}
    out = client.put(
        f"/api/v1/projects/{pid}/document",
        json=body,
        headers={**headers, "if-match": f'"{revision}"', "idempotency-key": revision + "-save"},
    )
    assert out.status_code == 200
    return out.json()["revision"]


def test_direct_download_mp4_combinations_and_temp_cleanup(tmp_path, monkeypatch, synthetic_audio):
    scratch = tmp_path / "scratch-tmp"
    scratch.mkdir()
    monkeypatch.setattr(tempfile, "tempdir", str(scratch))

    settings = Settings("pw", False)
    client = TestClient(create_app(tmp_path / "data", settings), base_url="https://studio")
    headers = _headers(client, settings)
    pid, asset = _project(client, headers, tmp_path, synthetic_audio)
    rev0 = client.get(f"/api/v1/projects/{pid}/document").json()["revision"]
    rev1 = _save(
        client,
        headers,
        pid,
        rev0,
        '<tt xmlns="http://www.w3.org/ns/ttml"><body><p begin="0s" end="1s">first</p></body></tt>',
    )

    # 1. Add STPP + LRC
    resp = client.post(
        f"/api/v1/projects/{pid}/packaging/download",
        json={
            "revision": rev1,
            "asset_id": asset,
            "stpp_action": "add",
            "lrc_kind": "lrc",
            "lrc_text": "[00:00.000]first\n[00:01.000]\n",
        },
        headers=headers,
    )
    assert resp.status_code == 200
    assert "attachment;" in resp.headers["content-disposition"]
    assert not list(scratch.iterdir())
    assert not (tmp_path / "data" / "projects" / pid / "exports").exists()

    first_out = tmp_path / "first.m4a"
    first_out.write_bytes(resp.content)
    assert len(stpp_tracks(first_out)) == 1
    assert b"first" in extract_stpp(first_out)
    assert File(first_out)["\xa9lyr"] == ["[00:00.000]first\n[00:01.000]\n"]

    # 2. MP4 LRC-only (stpp_action='none')
    resp_lrc = client.post(
        f"/api/v1/projects/{pid}/packaging/download",
        json={
            "revision": rev1,
            "asset_id": asset,
            "stpp_action": "none",
            "lrc_kind": "lrc",
            "lrc_text": "[00:00.000]only-lrc\n",
        },
        headers=headers,
    )
    assert resp_lrc.status_code == 200
    lrc_only_out = tmp_path / "lrc-only.m4a"
    lrc_only_out.write_bytes(resp_lrc.content)
    assert stpp_tracks(lrc_only_out) == []
    assert File(lrc_only_out)["\xa9lyr"] == ["[00:00.000]only-lrc\n"]
    assert not list(scratch.iterdir())

    # 3. Upload M4A that already has an STPP track: both add and overwrite work
    uploaded2 = client.post("/api/v1/uploads", files={"file": ("with-stpp.m4a", first_out.read_bytes(), "audio/mp4")}, headers=headers)
    assert uploaded2.status_code == 200
    pid2 = client.post(
        "/api/v1/projects",
        json={"name": "WithStpp", "upload_id": uploaded2.json()["id"]},
        headers={**headers, "idempotency-key": "project-stpp"},
    ).json()["id"]
    asset2 = uploaded2.json()["id"]
    info = client.get(f"/api/v1/projects/{pid2}/packaging").json()
    assert len(info["tracks"]) == 1
    existing_tid = info["tracks"][0]["track_id"]

    rev2_0 = client.get(f"/api/v1/projects/{pid2}/document").json()["revision"]
    rev2_1 = _save(
        client,
        headers,
        pid2,
        rev2_0,
        '<tt xmlns="http://www.w3.org/ns/ttml"><body><p begin="0s" end="1s">second</p></body></tt>',
    )

    resp_add = client.post(
        f"/api/v1/projects/{pid2}/packaging/download",
        json={"revision": rev2_1, "asset_id": asset2, "stpp_action": "add", "lrc_kind": "none", "lrc_text": None},
        headers=headers,
    )
    assert resp_add.status_code == 200
    added_out = tmp_path / "added-stpp.m4a"
    added_out.write_bytes(resp_add.content)
    added_tracks = stpp_tracks(added_out)
    assert len(added_tracks) == 2
    assert b"first" in extract_stpp(added_out, existing_tid)
    new_tid = next(t["track_id"] for t in added_tracks if t["track_id"] != existing_tid)
    assert b"second" in extract_stpp(added_out, new_tid)

    resp_overwrite = client.post(
        f"/api/v1/projects/{pid2}/packaging/download",
        json={
            "revision": rev2_1,
            "asset_id": asset2,
            "stpp_action": "overwrite",
            "target_track_id": existing_tid,
            "lrc_kind": "none",
            "lrc_text": None,
        },
        headers=headers,
    )
    assert resp_overwrite.status_code == 200
    overwritten_out = tmp_path / "overwritten.m4a"
    overwritten_out.write_bytes(resp_overwrite.content)
    assert len(stpp_tracks(overwritten_out)) == 1
    assert b"second" in extract_stpp(overwritten_out, existing_tid)
    assert not list(scratch.iterdir())


def test_direct_download_validation_and_mp3(tmp_path, synthetic_audio):
    settings = Settings("pw", False)
    client = TestClient(create_app(tmp_path / "data", settings), base_url="https://studio")
    headers = _headers(client, settings)
    pid, asset = _project(client, headers, tmp_path, synthetic_audio, "tone.mp3", "libmp3lame", "audio/mpeg")
    rev = client.get(f"/api/v1/projects/{pid}/document").json()["revision"]

    # Both none -> 422
    assert client.post(
        f"/api/v1/projects/{pid}/packaging/download",
        json={"revision": rev, "asset_id": asset, "stpp_action": "none", "lrc_kind": "none", "lrc_text": None},
        headers=headers,
    ).status_code == 422

    # STPP on MP3 -> 422
    assert client.post(
        f"/api/v1/projects/{pid}/packaging/download",
        json={"revision": rev, "asset_id": asset, "stpp_action": "add", "lrc_kind": "lrc", "lrc_text": "[00:00.000]hi\n"},
        headers=headers,
    ).status_code == 422

    # Missing revision -> 409
    assert client.post(
        f"/api/v1/projects/{pid}/packaging/download",
        json={"revision": "missing-rev", "asset_id": asset, "stpp_action": "none", "lrc_kind": "lrc", "lrc_text": "[00:00.000]hi\n"},
        headers=headers,
    ).status_code == 409

    # Valid MP3 download
    ok = client.post(
        f"/api/v1/projects/{pid}/packaging/download",
        json={"revision": rev, "asset_id": asset, "stpp_action": "none", "lrc_kind": "elrc", "lrc_text": "[00:00.000]<00:00.000>hi<00:01.000>\n"},
        headers=headers,
    )
    assert ok.status_code == 200
    mp3_out = tmp_path / "out.mp3"
    mp3_out.write_bytes(ok.content)
    assert File(mp3_out).tags.get("USLT::eng").text == "[00:00.000]<00:00.000>hi<00:01.000>\n"

    # Unauthenticated -> 401
    anon = TestClient(create_app(tmp_path / "data", settings), base_url="https://studio")
    assert anon.post(
        f"/api/v1/projects/{pid}/packaging/download",
        json={"revision": rev, "asset_id": asset, "stpp_action": "none", "lrc_kind": "lrc", "lrc_text": "[00:00.000]hi\n"},
    ).status_code == 401
