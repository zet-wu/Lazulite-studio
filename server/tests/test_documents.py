from pathlib import Path

from fastapi.testclient import TestClient

from server.app import create_app
from server.auth import Settings
from server.db import Database
from server.revisions import RevisionStore


def setup_project(tmp_path: Path) -> str:
    db = Database(tmp_path / "studio.sqlite3")
    store = RevisionStore(db, tmp_path / "revisions")
    with db.transaction() as c:
        c.execute("INSERT INTO projects VALUES(?,?,?,?,?,?)", ("p", "Demo", None, None, "now", "now"))
    store.create_initial("p", operation_id="init")
    return "p"


def test_document_save_retry_and_cas_preserves_unknown(tmp_path):
    setup_project(tmp_path)
    client = TestClient(create_app(tmp_path, Settings(None, True, "http://studio")), base_url="https://studio")
    headers = {"origin": "http://studio", "idempotency-key": "save-1", "if-match": client.get("/api/v1/projects/p/document").headers["etag"]}
    ttml = '<tt xmlns="http://www.w3.org/ns/ttml" xmlns:x="urn:example"><body><div><p begin="0s" end="1s">Hi<x:mark/></p></div></body></tt>'
    body = {"schema_version": "studio-document-v1", "project_id": "p", "revision": headers["if-match"].strip('"'), "client_seq": 3, "document": {"schema_version": "studio-document-content-v1", "ttml": ttml}}
    first = client.put("/api/v1/projects/p/document", json=body, headers=headers)
    assert first.status_code == 200 and first.json()["saved"]["client_seq"] == 3
    assert client.put("/api/v1/projects/p/document", json=body, headers=headers).json()["revision"] == first.json()["revision"]
    assert client.get("/api/v1/projects/p/document").json()["document"]["ttml"] == ttml
    stale = {**headers, "idempotency-key": "save-2"}
    assert client.put("/api/v1/projects/p/document", json=body, headers=stale).status_code == 412


def test_semantic_editor_ttml_saves_and_reopens_with_clean_main_lyrics(tmp_path):
    setup_project(tmp_path)
    client = TestClient(create_app(tmp_path, Settings(None, True, "http://studio")), base_url="https://studio")
    source = Path(__file__).resolve().parents[2] / "docs/evidence/editor-e0/studio-roundtrip.ttml"
    ttml = source.read_text(encoding="utf-8").replace("きょ</span>", "きよう</span>")
    before = client.get("/api/v1/projects/p/document")
    revision = before.json()["revision"]
    body = {"schema_version": "studio-document-v1", "project_id": "p", "revision": revision,
            "document": {"schema_version": "studio-document-content-v1", "ttml": ttml}}
    saved = client.put("/api/v1/projects/p/document", json=body, headers={
        "origin": "http://studio", "if-match": before.headers["etag"], "idempotency-key": "semantic-edit"})
    assert saved.status_code == 200
    reopened = client.get("/api/v1/projects/p/document")
    assert reopened.json()["revision"] == saved.json()["revision"]
    assert reopened.json()["document"]["ttml"] == ttml
    assert "きよう" in reopened.json()["document"]["ttml"]
    lyrics = client.get("/api/v1/projects/p/lyrics")
    assert lyrics.status_code == 200
    assert lyrics.text == ttml


def test_e3_draft_end_link_survives_real_project_save(tmp_path):
    setup_project(tmp_path)
    client = TestClient(create_app(tmp_path, Settings(None, True, "http://studio")), base_url="https://studio")
    ttml = ('<tt xmlns="http://www.w3.org/ns/ttml" xmlns:studio="urn:lazulite:studio:draft">'
            '<body><div><p xml:id="a" begin="1" end="3" '
            'studio:endLink=\'{"targetLineId":"b","originalEndUs":2500000}\'>'
            '<span begin="1" end="2">中文</span></p>'
            '<p xml:id="b" begin="3" end="4"><span begin="3" end="4">下一句</span></p>'
            '</div></body></tt>')
    before = client.get("/api/v1/projects/p/document")
    saved = client.put("/api/v1/projects/p/document", json={
        "schema_version": "studio-document-v1", "project_id": "p", "revision": before.json()["revision"],
        "document": {"schema_version": "studio-document-content-v1", "ttml": ttml}},
        headers={"origin": "http://studio", "if-match": before.headers["etag"], "idempotency-key": "e3-end-link"})
    assert saved.status_code == 200
    reopened = client.get("/api/v1/projects/p/document")
    assert reopened.json()["document"]["ttml"] == ttml
    assert reopened.json()["revision"] == saved.json()["revision"]


def test_import_is_candidate_and_does_not_change_revision(tmp_path):
    setup_project(tmp_path)
    client = TestClient(create_app(tmp_path, Settings(None, True, "http://studio")), base_url="https://studio")
    before = client.get("/api/v1/projects/p/document")
    out = client.post("/api/v1/projects/p/imports?revision=" + before.json()["revision"], content="[00:01.25]hello\n", headers={"origin": "http://studio", "content-type": "text/lrc"})
    assert out.status_code == 200 and out.json()["saved"] is False and out.json()["candidate"]["lines"][0]["begin_us"] == 1250000
    assert client.get("/api/v1/projects/p/document").json()["revision"] == before.json()["revision"]


def test_import_lrc_multiple_tags_metadata_offset_and_plain_text(tmp_path):
    setup_project(tmp_path)
    client = TestClient(create_app(tmp_path, Settings(None, True, "http://studio")), base_url="https://studio")
    revision = client.get("/api/v1/projects/p/document").json()["revision"]
    lrc = "[ti:Demo]\n[offset:1000]\n[00:01.00][00:02.00]hello\n[00:03.00]world\n"
    out = client.post(f"/api/v1/projects/p/imports?revision={revision}", content=lrc, headers={"origin": "http://studio", "content-type": "text/lrc"})
    assert out.status_code == 200
    assert out.json()["input_revision"] == revision
    assert [(x["begin_us"], x["end_us"], x["text"]) for x in out.json()["candidate"]["lines"]] == [(2_000_000, 3_000_000, "hello"), (3_000_000, 4_000_000, "hello"), (4_000_000, None, "world")]
    plain = client.post(f"/api/v1/projects/p/imports?revision={revision}", content="[00:01.00]literal\n", headers={"origin": "http://studio", "content-type": "text/plain"})
    assert plain.json()["candidate"]["lines"][0]["text"] == "[00:01.00]literal"
    missing = client.post("/api/v1/projects/p/imports?revision=missing", content="x", headers={"origin": "http://studio", "content-type": "text/plain"})
    assert missing.status_code == 404


def test_review_tracks_only_changed_line_and_save_is_atomic(tmp_path):
    setup_project(tmp_path)
    db = Database(tmp_path / "studio.sqlite3")
    store = RevisionStore(db, tmp_path / "revisions")
    with db.transaction() as c:
        old = c.execute("SELECT current_revision FROM projects WHERE id='p'").fetchone()[0]
    xml = '<tt xmlns="http://www.w3.org/ns/ttml"><body><div><p xml:id="a" begin="0s" end="1s">A</p><p xml:id="b" begin="1s" end="2s">B</p></div></body></tt>'
    rev = store.create("p", xml, old)["id"]
    client = TestClient(create_app(tmp_path, Settings(None, True, "http://studio")), base_url="https://studio")
    doc = client.get("/api/v1/projects/p/document").json()
    review = client.get("/api/v1/projects/p/review").json()
    patch_headers = {"origin": "http://studio", "if-match": f'"{review["version"]}"'}
    confirmed = client.patch("/api/v1/projects/p/review", json={"line_id": "a", "document_revision": doc["revision"], "confirmed": True}, headers=patch_headers)
    assert confirmed.status_code == 200
    body = {"schema_version": "studio-document-v1", "project_id": "p", "revision": doc["revision"], "document": {"schema_version": "studio-document-content-v1", "ttml": xml.replace('>B</p>', '>B2</p>')}}
    changed = client.put("/api/v1/projects/p/document", json=body, headers={"origin": "http://studio", "if-match": f'"{doc["revision"]}"', "idempotency-key": "change-b"})
    assert changed.status_code == 200
    items = {x["line_id"]: x for x in client.get("/api/v1/projects/p/review").json()["items"]}
    assert items["a"]["status"] == "confirmed" and items["a"]["revision"] == changed.json()["revision"]
    old_patch = client.patch("/api/v1/projects/p/review", json={"line_id": "a", "document_revision": doc["revision"], "confirmed": True}, headers={"origin": "http://studio", "if-match": '"1"'})
    assert old_patch.status_code == 412
    newer = {**body, "revision": changed.json()["revision"], "document": {"schema_version": "studio-document-content-v1", "ttml": xml.replace('>A</p>', '>A2</p>').replace('>B</p>', '>B2</p>')}}
    saved = client.put("/api/v1/projects/p/document", json=newer, headers={"origin": "http://studio", "if-match": f'"{changed.json()["revision"]}"', "idempotency-key": "change-a"})
    assert saved.status_code == 200
    items = {x["line_id"]: x for x in client.get("/api/v1/projects/p/review").json()["items"]}
    assert items["a"]["status"] == "stale"
    with db.transaction() as c:
        c.execute("CREATE TRIGGER reject_review_update BEFORE UPDATE OF status ON review_confirmations BEGIN SELECT RAISE(ABORT, 'blocked'); END")
    before = client.get("/api/v1/projects/p/document").json()["revision"]
    failed = client.put("/api/v1/projects/p/document", json=newer, headers={"origin": "http://studio", "if-match": f'"{before}"', "idempotency-key": "change-c"})
    assert failed.status_code >= 400
    assert client.get("/api/v1/projects/p/document").json()["revision"] == before
