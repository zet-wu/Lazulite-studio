"""Portable MCP host lifecycle, loopback proxy security, and real FastAPI E2E tests."""
from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import socket
import threading
import time

from fastapi.testclient import TestClient
import httpx
import pytest
import uvicorn

from server import mcp_host
from server.app import create_app
from server.auth import Settings
from server.db import Database
from server.local_web import mount_frontend
from server.project_document import initial_project
from server.revisions import RevisionStore

REPO_ROOT = Path(__file__).resolve().parents[2]
MCP_BUNDLE = REPO_ROOT / "mcp" / "dist" / "server.mjs"


def _node_binary() -> Path | None:
    found = shutil.which("node")
    return Path(found) if found else None


def _pick_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def _mcp_post(
    client: httpx.Client,
    url: str,
    payload: dict,
    *,
    session_id: str | None = None,
    headers: dict[str, str] | None = None,
):
    req_headers = {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
        **(headers or {}),
    }
    if session_id:
        req_headers["mcp-session-id"] = session_id
    resp = client.post(url, json=payload, headers=req_headers)
    return resp


def _parse_mcp_json(resp: httpx.Response) -> dict:
    ct = resp.headers.get("content-type", "")
    if "text/event-stream" in ct:
        for line in resp.text.splitlines():
            if line.startswith("data: "):
                data = line[6:].strip()
                if data:
                    return json.loads(data)
        raise AssertionError(f"Empty SSE response: {resp.text!r}")
    return resp.json()


def test_find_mcp_runtime_requires_node_and_bundle(tmp_path):
    assert mcp_host.find_mcp_runtime(tmp_path) is None
    node_bin = mcp_host.bundled_node_path(tmp_path)
    node_bin.parent.mkdir(parents=True)
    node_bin.write_bytes(b"node")
    assert mcp_host.find_mcp_runtime(tmp_path) is None
    script = tmp_path / "app" / "mcp" / "server.mjs"
    script.parent.mkdir(parents=True)
    script.write_text("export {};\n", encoding="utf-8")
    assert mcp_host.find_mcp_runtime(tmp_path) == (node_bin, script)


@pytest.mark.skipif(not MCP_BUNDLE.is_file() or _node_binary() is None, reason="Node 22 and mcp/dist/server.mjs required")
def test_mcp_process_lifecycle_proxy_security_and_clean_stop(tmp_path):
    node_bin = _node_binary()
    assert node_bin is not None

    studio_root = tmp_path / "studio"
    app = create_app(studio_root, Settings(mode="local"))
    identity_file = studio_root / "runtime" / "identity.json"
    identity_file.parent.mkdir(parents=True, exist_ok=True)
    identity_file.write_text(json.dumps({"port": 15999}), encoding="utf-8")

    handle = mcp_host.start_mcp_process(
        node_bin,
        MCP_BUNDLE,
        studio_origin="http://127.0.0.1:15999",
        identity_file=identity_file,
    )
    try:
        mcp_host.mount_mcp_proxy(app, f"http://127.0.0.1:{handle.port}")
        dist = tmp_path / "dist"
        dist.mkdir()
        (dist / "index.html").write_text("<html></html>", encoding="utf-8")
        mount_frontend(app, dist)

        with TestClient(app, base_url="http://127.0.0.1:15999") as client:
            # Non-loopback host or origin is rejected
            bad_host = client.post("/mcp", json={}, headers={"host": "evil.example:15999"})
            assert bad_host.status_code == 403
            bad_origin = client.post("/mcp", json={}, headers={"origin": "https://evil.example"})
            assert bad_origin.status_code == 403
            # Missing /mcp/* subpaths do not fall back to SPA HTML
            assert client.get("/mcp/unknown").status_code == 404

            # Initialize & list tools over FastAPI /mcp proxy
            init_resp = client.post(
                "/mcp",
                json={
                    "jsonrpc": "2.0",
                    "id": 1,
                    "method": "initialize",
                    "params": {
                        "protocolVersion": "2024-11-05",
                        "capabilities": {},
                        "clientInfo": {"name": "pytest", "version": "1.0"},
                    },
                },
                headers={
                    "Accept": "application/json, text/event-stream",
                    "Content-Type": "application/json",
                },
            )
            assert init_resp.status_code == 200
            session_id = init_resp.headers.get("mcp-session-id")
            assert session_id

            notif = client.post(
                "/mcp",
                json={"jsonrpc": "2.0", "method": "notifications/initialized"},
                headers={
                    "mcp-session-id": session_id,
                    "Content-Type": "application/json",
                    "Accept": "application/json, text/event-stream",
                },
            )
            assert notif.status_code in (200, 202)

            tools_resp = client.post(
                "/mcp",
                json={"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}},
                headers={
                    "mcp-session-id": session_id,
                    "Accept": "application/json, text/event-stream",
                    "Content-Type": "application/json",
                },
            )
            assert tools_resp.status_code == 200
            ct = tools_resp.headers.get("content-type", "")
            if "text/event-stream" in ct:
                payload = next(
                    json.loads(line[6:])
                    for line in tools_resp.text.splitlines()
                    if line.startswith("data: ") and line[6:].strip()
                )
            else:
                payload = tools_resp.json()
            names = [t["name"] for t in payload["result"]["tools"]]
            assert len(names) == 36
            assert "apply_alignment_result" in names
    finally:
        handle.stop()

    # Subprocess must have terminated cleanly without orphans
    assert handle.process.poll() is not None


@pytest.mark.skipif(not MCP_BUNDLE.is_file() or _node_binary() is None, reason="Node 22 and mcp/dist/server.mjs required")
def test_real_fastapi_lyric_editing_and_alignment_via_mcp(tmp_path, monkeypatch):
    from server import alignment, worker_process
    from server.tests.test_alignment_models import model as build_test_model
    from server.tests.test_vocals import setup as setup_vocal_project, Separator

    monkeypatch.setattr(alignment, "alignment_unavailable", lambda: None)
    original_popen = worker_process.subprocess.Popen

    def fake_worker(args, **kwargs):
        if args[-1] == "server.alignment_worker":
            args = [*args[:-1], "server.tests.alignment_worker_fixture"]
        return original_popen(args, **kwargs)

    monkeypatch.setattr(worker_process.subprocess, "Popen", fake_worker)

    models_dir = tmp_path / "models"
    build_test_model(models_dir)
    monkeypatch.setenv("STUDIO_ALIGNMENT_MODELS_DIR", str(models_dir))

    vocal_dir = tmp_path / "vocal-models" / "demucs"
    vocal_dir.mkdir(parents=True)
    (vocal_dir / "htdemucs.yaml").write_text("models: [test]\n", encoding="utf-8")
    (vocal_dir / "test-weights.th").write_bytes(b"fixture-weights")
    monkeypatch.setenv("STUDIO_VOCAL_MODELS_DIR", str(vocal_dir.parent))

    # Build app with real SQLite + asset + Sudachi reading + vocal/alignment runners
    test_client, db = setup_vocal_project(tmp_path, factory=Separator)
    app = test_client.app
    # Seed a clean initial document on project 'p'
    with db.connect() as conn:
        row = conn.execute("SELECT current_revision, source_asset_id FROM projects WHERE id='p'").fetchone()
    base_rev, _asset_id = row[0], row[1]
    snapshot = initial_project('<tt xmlns="http://www.w3.org/ns/ttml" xmlns:studio="urn:lazulite:studio:draft"><body><p xml:id="l0"><span studio:id="w0">stub</span></p></body></tt>')
    RevisionStore(db, tmp_path / "projects").create("p", snapshot, base_rev)

    port = _pick_port()
    origin = f"http://127.0.0.1:{port}"
    identity_file = tmp_path / "identity.json"
    identity_file.write_text(json.dumps({"port": port}), encoding="utf-8")

    node_bin = _node_binary()
    assert node_bin is not None
    mcp_handle = mcp_host.start_mcp_process(
        node_bin,
        MCP_BUNDLE,
        studio_origin=origin,
        identity_file=identity_file,
    )
    mcp_host.mount_mcp_proxy(app, f"http://127.0.0.1:{mcp_handle.port}")

    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning"))
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()

    try:
        with httpx.Client(trust_env=False, timeout=20.0) as http:
            for _ in range(100):
                try:
                    if http.get(f"{origin}/api/v1/session").status_code == 200:
                        break
                except (OSError, httpx.HTTPError):
                    time.sleep(0.05)
            else:
                raise AssertionError("Uvicorn did not become ready")

            # Start SSE stream listener before MCP writes
            sse_events: list[str] = []
            sse_ready = threading.Event()
            stop_sse = threading.Event()

            def read_sse():
                with httpx.Client(trust_env=False, timeout=None) as shttp:
                    with shttp.stream("GET", f"{origin}/api/v1/projects/p/events") as resp:
                        sse_ready.set()
                        for line in resp.iter_lines():
                            sse_events.append(line)
                            if stop_sse.is_set() or sum("revision_changed" in item for item in sse_events) >= 4:
                                break

            sse_thread = threading.Thread(target=read_sse, daemon=True)
            sse_thread.start()
            assert sse_ready.wait(timeout=3.0)

            mcp_url = f"{origin}/mcp"
            init = _mcp_post(
                http,
                mcp_url,
                {
                    "jsonrpc": "2.0",
                    "id": 1,
                    "method": "initialize",
                    "params": {
                        "protocolVersion": "2024-11-05",
                        "capabilities": {},
                        "clientInfo": {"name": "e2e", "version": "1.0"},
                    },
                },
            )
            assert init.status_code == 200
            session_id = init.headers["mcp-session-id"]
            _mcp_post(http, mcp_url, {"jsonrpc": "2.0", "method": "notifications/initialized"}, session_id=session_id)

            req_id = 1

            def call_tool(name: str, arguments: dict, *, raw=False) -> dict:
                nonlocal req_id
                req_id += 1
                resp = _mcp_post(
                    http,
                    mcp_url,
                    {"jsonrpc": "2.0", "id": req_id, "method": "tools/call", "params": {"name": name, "arguments": arguments}},
                    session_id=session_id,
                )
                assert resp.status_code == 200
                body = _parse_mcp_json(resp)["result"]
                assert not body.get("isError"), f"{name} failed: {body}"
                return body if raw else json.loads(body["content"][0]["text"])

            # Scenario 1: Import plain Japanese lyrics + preserve acoustics
            imported = call_tool(
                "import_lyrics",
                {"project_id": "p", "format": "txt", "content": "今日", "mode": "replace_all"},
            )
            assert imported["changed"] is True
            rev_after_import = imported["new_revision"]

            # Scenario 2: Update metadata & singers
            meta = call_tool(
                "update_metadata",
                {
                    "project_id": "p",
                    "expected_revision": rev_after_import,
                    "language": "ja",
                    "set": {"title": ["E2E Song"]},
                },
            )
            rev_after_meta = meta["new_revision"]
            lyrics_view = call_tool("get_lyrics", {"project_id": "p"})
            line_id = lyrics_view["lines"][0]["line_id"]

            # Scenario 3: Analyze Japanese reading (real Sudachi) & apply readings
            ja = call_tool("analyze_japanese_reading", {"project_id": "p"})
            assert ja["lines"][0]["text"] == "今日"
            read_res = call_tool(
                "apply_readings",
                {
                    "project_id": "p",
                    "expected_revision": rev_after_meta,
                    "operations": [
                        {
                            "mode": "set_line_spans",
                            "line_id": line_id,
                            "spans": [{"base_start": 0, "base_end": 2, "base": "今日", "readings": ["きょう"]}],
                        }
                    ],
                },
            )
            rev_after_reading = read_res["new_revision"]

            # Also verify 412 CAS rejection on stale revision
            req_id += 1
            stale_resp = _parse_mcp_json(
                _mcp_post(
                    http,
                    mcp_url,
                    {
                        "jsonrpc": "2.0",
                        "id": req_id,
                        "method": "tools/call",
                        "params": {
                            "name": "update_metadata",
                            "arguments": {"project_id": "p", "expected_revision": rev_after_import, "set": {"title": ["Stale"]}},
                        },
                    },
                    session_id=session_id,
                )
            )["result"]
            assert stale_resp.get("isError") is True
            stale_err = json.loads(stale_resp["content"][0]["text"])
            assert stale_err["details"]["status"] == 412
            assert stale_err["details"]["current_revision"] == rev_after_reading

            # Scenario 4: Alignment models -> preview -> start -> poll -> apply_alignment_result
            models = call_tool("list_alignment_models", {})
            model_id = next(item["id"] for item in models["items"] if item["status"] == "ready")
            preview = call_tool("preview_alignment", {"project_id": "p", "model_id": model_id})
            assert preview["emitting_count"] >= 1
            started = call_tool(
                "start_alignment",
                {"project_id": "p", "model_preview": preview["model_preview"], "revision": rev_after_reading},
            )
            job_id = started["job_id"]
            for _ in range(80):
                status = call_tool("get_job_status", {"job_id": job_id})
                if status["status"] == "succeeded":
                    break
                assert status["status"] in ("queued", "running")
                time.sleep(0.05)
            else:
                raise AssertionError("Alignment job did not finish")

            aligned = call_tool("apply_alignment_result", {"job_id": job_id})
            assert aligned["changed"] is True
            assert aligned["acknowledged_state"] == "applied"
            final_lyrics = call_tool("get_lyrics", {"project_id": "p"})
            assert final_lyrics["lines"][0]["words"][0]["begin_ms"] == 100
            assert final_lyrics["lines"][0]["words"][0]["end_ms"] == 200
            assert final_lyrics["lines"][0]["words"][0]["ruby_units"][0]["reading"] == "きょう"
            assert final_lyrics["lines"][0]["words"][0]["ruby_units"][0]["begin_ms"] == 100
            assert final_lyrics["lines"][0]["words"][0]["ruby_units"][0]["end_ms"] == 200

            # Local P0 reannotation with no reimport: saved ruby -> split surface -> new ruby.
            word_id = final_lyrics['lines'][0]['words'][0]['word_id']
            rewritten = call_tool('apply_readings', {'project_id':'p', 'expected_revision':final_lyrics['revision'], 'overwrite_existing':True,
                'operations':[{'mode':'split_and_set_word','line_id':line_id,'word_id':word_id,
                               'parts':[{'text':'今','readings':['きょ']},{'text':'日','readings':['う']}]}]})
            segmented = call_tool('get_lyrics', {'project_id':'p'})
            assert [w['text'] for w in segmented['lines'][0]['words']] == ['今','日']
            assert rewritten['created_word_ids'] == [segmented['lines'][0]['words'][1]['word_id']]
            # Default preview leaves the actual backend revision unchanged.
            dry = call_tool('generate_romanization', {'project_id':'p'})
            assert dry['dry_run'] and not dry['changed']
            assert call_tool('get_lyrics', {'project_id':'p'})['revision'] == segmented['revision']
            generated = call_tool('generate_romanization', {'project_id':'p','dry_run':False,'expected_revision':segmented['revision']})
            assert generated['changed'] and generated['revision'] == generated['new_revision']
            translation = call_tool('edit_sublyrics', {'project_id':'p','operations':[
                {'op':'create_track','kind':'translation','language':'zh','client_ref':'t'},
                {'op':'insert_content','kind':'translation','track_ref':'t','line_id':line_id,'content_kind':'plain','text':'测试译文','client_ref':'c'}]})
            tracks = call_tool('get_sublyrics', {'project_id':'p'})['tracks']
            assert len(tracks) == 2 and any(t['contents'][0]['text'] == '测试译文' for t in tracks)
            split = call_tool('edit_lyrics', {'project_id':'p','operations':[{'op':'split_line','line_id':line_id,'before_word_id':rewritten['created_word_ids'][0],'client_ref':'right',
                'translation_targets':{translation['created_refs']['c']:1}}]})
            right = split['created_refs']['right']
            adjusted = call_tool('edit_timing', {'project_id':'p','operations':[{'op':'set_word_time','line_id':right,'word_id':rewritten['created_word_ids'][0],'end_ms':250}]})
            assert adjusted['changed']
            ttml = call_tool('get_lyrics', {'project_id':'p','format':'editable_ttml','line_ids':[right]}, raw=True)
            assert len(ttml['content']) == 2
            assert json.loads(ttml['content'][0]['text'])['partial']
            assert 'studio:id' in ttml['content'][1]['text']
            vocal_job = call_tool('start_vocal_separation', {'project_id':'p','force_separation':True,'idempotency_key':'listen-vocal'})
            for _ in range(200):
                vocal_status = call_tool('get_job_status', {'job_id':vocal_job['job_id']})
                if vocal_status['status'] == 'succeeded': break
                assert vocal_status['status'] in ('queued','running'), vocal_status
                time.sleep(.05)
            else: raise AssertionError('Vocal analysis did not finish')
            vocal_result = call_tool('list_vocal_results', {'project_id':'p'})['items'][0]
            acoustics = call_tool('get_acoustics', {'project_id':'p','start_ms':0,'end_ms':500,'include_energy':True,'vocal_result_id':vocal_result['id'],'energy_buckets':25})
            assert len(acoustics['energy']['values']) <= 25
            excerpt = call_tool('get_audio_excerpt', {'project_id':'p','line_id':right,'source':'vocal','padding_ms':0}, raw=True)
            import base64, io, wave
            assert excerpt['content'][1]['type'] == 'audio'
            with wave.open(io.BytesIO(base64.b64decode(excerpt['content'][1]['data']))) as wav:
                assert (wav.getframerate(),wav.getnchannels(),wav.getsampwidth()) == (16000,1,2)
            assert call_tool('list_jobs', {'project_id':'p','kind':'alignment'})['items'][0]['acknowledged_state'] == 'applied'

            stop_sse.set()
            sse_thread.join(timeout=2.0)
            assert any("revision_changed" in line for line in sse_events)
    finally:
        mcp_handle.stop()
        server.should_exit = True
        thread.join(timeout=5.0)
        os.environ.pop("STUDIO_ALIGNMENT_MODELS_DIR", None)
        os.environ.pop("STUDIO_VOCAL_MODELS_DIR", None)
