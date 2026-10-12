from server.project_document import initial_project, read_lyrics
from server.time_units import normalize_ttml
from pathlib import Path

from fastapi.testclient import TestClient

from server.app import create_app
from server.auth import Settings
from server.db import Database
from server.revisions import RevisionStore


def setup_project(tmp_path: Path) -> str:
    db = Database(tmp_path / "studio.sqlite3")
    store = RevisionStore(db, tmp_path / "projects")
    with db.transaction() as c:
        c.execute("INSERT INTO projects VALUES(?,?,?,?,?,?)", ("p", "Demo", None, None, "now", "now"))
    store.create_initial("p", operation_id="init")
    return "p"


def test_document_save_retry_and_cas_preserves_unknown(tmp_path):
    setup_project(tmp_path)
    client = TestClient(create_app(tmp_path, Settings(None, True, "http://studio")), base_url="https://studio")
    headers = {"origin": "http://studio", "idempotency-key": "save-1", "if-match": client.get("/api/v1/projects/p/document").headers["etag"]}
    ttml = '<tt xmlns="http://www.w3.org/ns/ttml" xmlns:x="urn:example"><body><div><p begin="0s" end="1s">Hi<x:mark/></p></div></body></tt>'
    body = {"schema_version": "studio-document-v9", "project_id": "p", "revision": headers["if-match"].strip('"'), "client_seq": 3, "document": initial_project(ttml, None)}
    first = client.put("/api/v1/projects/p/document", json=body, headers=headers)
    assert first.status_code == 200 and first.json()["saved"]["client_seq"] == 3
    assert client.put("/api/v1/projects/p/document", json=body, headers=headers).json()["revision"] == first.json()["revision"]
    assert client.get("/api/v1/projects/p/document").json()["document"]["lyrics"]["draftTtml"] == normalize_ttml(ttml)
    stale = {**headers, "idempotency-key": "save-2"}
    assert client.put("/api/v1/projects/p/document", json=body, headers=stale).status_code == 412


def test_semantic_editor_ttml_saves_and_reopens_with_clean_main_lyrics(tmp_path):
    setup_project(tmp_path)
    client = TestClient(create_app(tmp_path, Settings(None, True, "http://studio")), base_url="https://studio")
    source = Path(__file__).resolve().parents[2] / "tests/fixtures/ttml/studio-roundtrip.ttml"
    ttml = source.read_text(encoding="utf-8").replace("きょ</span>", "きよう</span>")
    before = client.get("/api/v1/projects/p/document")
    revision = before.json()["revision"]
    body = {"schema_version": "studio-document-v9", "project_id": "p", "revision": revision,
            "document": initial_project(ttml, None)}
    saved = client.put("/api/v1/projects/p/document", json=body, headers={
        "origin": "http://studio", "if-match": before.headers["etag"], "idempotency-key": "semantic-edit"})
    assert saved.status_code == 200
    reopened = client.get("/api/v1/projects/p/document")
    assert reopened.json()["revision"] == saved.json()["revision"]
    assert reopened.json()["document"]["lyrics"]["draftTtml"] == normalize_ttml(ttml)
    assert "きよう" in reopened.json()["document"]["lyrics"]["draftTtml"]
    lyrics = client.get("/api/v1/projects/p/lyrics")
    assert lyrics.status_code == 200
    assert lyrics.text == normalize_ttml(ttml)


def test_project_editing_survives_real_project_save(tmp_path):
    setup_project(tmp_path)
    client = TestClient(create_app(tmp_path, Settings(None, True, "http://studio")), base_url="https://studio")
    ttml = ('<tt xmlns="http://www.w3.org/ns/ttml" xmlns:studio="urn:lazulite:studio:draft">'
            '<body><div><p xml:id="a" begin="1" end="3">'
            '<span begin="1" end="2">中文</span></p>'
            '<p xml:id="b" begin="3" end="4"><span begin="3" end="4">下一句</span></p>'
            '</div></body></tt>')
    before = client.get("/api/v1/projects/p/document")
    snapshot = initial_project(ttml, None)
    snapshot['editing']['endLinks'] = {'a': 'b'}
    snapshot['editing']['ignoredSyncLineIds'] = ['a']
    saved = client.put("/api/v1/projects/p/document", json={
        "schema_version": "studio-document-v9", "project_id": "p", "revision": before.json()["revision"],
        "document": snapshot},
        headers={"origin": "http://studio", "if-match": before.headers["etag"], "idempotency-key": "e3-end-link"})
    assert saved.status_code == 200
    reopened = client.get("/api/v1/projects/p/document")
    assert reopened.json()["document"]["lyrics"]["draftTtml"] == normalize_ttml(ttml)
    assert reopened.json()["revision"] == saved.json()["revision"]

    assert reopened.json()['document']['editing'] == snapshot['editing']

def test_import_is_candidate_and_does_not_change_revision(tmp_path):
    setup_project(tmp_path)
    client = TestClient(create_app(tmp_path, Settings(None, True, "http://studio")), base_url="https://studio")
    before = client.get("/api/v1/projects/p/document")
    out = client.post("/api/v1/projects/p/imports?revision=" + before.json()["revision"], content="[00:01.25]hello\n", headers={"origin": "http://studio", "content-type": "text/lrc"})
    assert out.status_code == 200 and out.json()["saved"] is False and out.json()["candidate"]["lines"][0]["begin_ms"] == 1250
    assert client.get("/api/v1/projects/p/document").json()["revision"] == before.json()["revision"]


def test_import_lrc_multiple_tags_metadata_offset_and_plain_text(tmp_path):
    setup_project(tmp_path)
    client = TestClient(create_app(tmp_path, Settings(None, True, "http://studio")), base_url="https://studio")
    revision = client.get("/api/v1/projects/p/document").json()["revision"]
    lrc = "[ti:Demo]\n[offset:1000]\n[00:01.00][00:02.00]hello\n[00:03.00]world\n"
    out = client.post(f"/api/v1/projects/p/imports?revision={revision}", content=lrc, headers={"origin": "http://studio", "content-type": "text/lrc"})
    assert out.status_code == 200
    assert out.json()["input_revision"] == revision
    assert [(x["begin_ms"], x["end_ms"], x["text"]) for x in out.json()["candidate"]["lines"]] == [(2000, 3000, "hello"), (3000, 4000, "hello"), (4000, None, "world")]
    plain = client.post(f"/api/v1/projects/p/imports?revision={revision}", content="[00:01.00]literal\n", headers={"origin": "http://studio", "content-type": "text/plain"})
    assert plain.json()["candidate"]["lines"][0]["text"] == "[00:01.00]literal"
    missing = client.post("/api/v1/projects/p/imports?revision=missing", content="x", headers={"origin": "http://studio", "content-type": "text/plain"})
    assert missing.status_code == 404



def test_acoustic_edit_is_saved_atomically(tmp_path):
    from server.tests.media_fixture import add_media_project
    import subprocess
    db = Database(tmp_path / 'studio.sqlite3')
    store = RevisionStore(db, tmp_path / 'projects')
    audio = tmp_path / 'source.wav'
    subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo', '-t', '2', str(audio)], check=True)
    add_media_project(tmp_path, db, store, 'p', audio, '<tt xmlns="http://www.w3.org/ns/ttml"><body><p xml:id="a" begin="0" end="1">A</p></body></tt>')
    client = TestClient(create_app(tmp_path, Settings(None, True, 'http://studio')))
    before = client.get('/api/v1/projects/p/document')
    envelope = before.json()
    envelope['document']['acoustics']['segments'] = [{'id': 's', 'beginMs': 100, 'endMs': 1500}]
    body = {k: envelope[k] for k in ('schema_version', 'project_id', 'revision', 'document')}
    response = client.put('/api/v1/projects/p/document', json=body, headers={'origin': 'http://studio', 'if-match': before.headers['etag']})
    assert response.status_code == 200
    reopened = client.get('/api/v1/projects/p/document').json()
    assert reopened['document'] == envelope['document']
    assert client.put('/api/v1/projects/p/document', json=body, headers={'origin': 'http://studio', 'if-match': before.headers['etag']}).status_code == 412
    body['revision'] = reopened['revision']
    body['document']['sourceAssetId'] = 'wrong'
    assert client.put('/api/v1/projects/p/document', json=body, headers={'origin': 'http://studio', 'if-match': reopened['revision']}).status_code == 422
    assert client.get('/api/v1/projects/p/document').json()['revision'] == reopened['revision']


def test_timed_translation_real_save_preserves_purpose_units_and_unknown_draft_time(tmp_path):
    import xml.etree.ElementTree as ET
    setup_project(tmp_path)
    client = TestClient(create_app(tmp_path, Settings(None, True, "http://studio")), base_url="https://studio")
    source = Path(__file__).resolve().parents[2] / "tests/fixtures/ttml/timeline-translation-external.ttml"
    ttml = source.read_text(encoding="utf-8")
    ttml = ttml.replace('xmlns:ttm=', 'xmlns:studio="urn:lazulite:studio:draft" xmlns:ttm=', 1)
    ttml = ttml.replace('begin="500ms"', 'studio:id="translation-unit" studio:null="begin"', 1)
    before = client.get("/api/v1/projects/p/document")
    saved = client.put("/api/v1/projects/p/document", json={
        "schema_version": "studio-document-v9", "project_id": "p", "revision": before.json()["revision"],
        "document": initial_project(ttml, None)}, headers={
        "origin": "http://studio", "if-match": before.headers["etag"], "idempotency-key": "timed-translation"})
    assert saved.status_code == 200
    reopened = client.get("/api/v1/projects/p/document").json()["document"]["lyrics"]["draftTtml"]
    root = ET.fromstring(reopened)
    ns = '{http://music.apple.com/lyric-ttml-internal}'
    tracks = list(root.iter(ns + 'translation'))
    assert len(tracks) == 3 and tracks[0].get('type') == 'replacement'
    first = tracks[0].find(ns + 'text').find(ns + 'span')
    assert first.text == ' 黃金 ' and first.get('begin') is None
    assert first.get('{urn:lazulite:studio:draft}id') == 'translation-unit'
    assert first.get('{urn:lazulite:studio:draft}null') == 'begin'
    assert first.get('end') == '00:01.250'


def test_invalid_project_editing_is_rejected_without_revision_change(tmp_path):
    from copy import deepcopy
    setup_project(tmp_path)
    client = TestClient(create_app(tmp_path, Settings(None, True, "http://studio")), base_url="https://studio")
    before = client.get('/api/v1/projects/p/document')
    snapshot = initial_project('<tt xmlns="http://www.w3.org/ns/ttml" xmlns:studio="urn:lazulite:studio:draft"><body><p xml:id="a" begin="0" end="1"><span studio:id="w" begin="0" end="1">A</span></p></body></tt>', None)
    invalid = [
        {'emptyBeats': {'w': {'kind': 'word', 'count': 33}}},
        {'emptyBeats': {'w': {'kind': 'ruby', 'count': 1}}},
        {'emptyBeats': {'missing': {'kind': 'word', 'count': 1}}},
        {'ignoredSyncLineIds': ['a', 'a']},
        {'endLinks': {'a': 'missing'}},
    ]
    for patch in invalid:
        document = deepcopy(snapshot)
        document['editing'].update(patch)
        response = client.put('/api/v1/projects/p/document', json={'schema_version': 'studio-document-v9', 'project_id': 'p', 'revision': before.json()['revision'], 'document': document}, headers={'origin': 'http://studio', 'if-match': before.headers['etag']})
        assert response.status_code == 422, response.text
        assert client.get('/api/v1/projects/p/document').json()['revision'] == before.json()['revision']


def test_karaoke_project_save_reopen_keeps_cues_outside_ttml(tmp_path):
    from copy import deepcopy
    setup_project(tmp_path)
    client = TestClient(create_app(tmp_path, Settings(None, True, 'http://studio')), base_url='https://studio')
    before = client.get('/api/v1/projects/p/document')
    snapshot = initial_project('<tt xmlns="http://www.w3.org/ns/ttml" xmlns:studio="urn:lazulite:studio:draft"><body><p xml:id="a" begin="4" end="5"><span studio:id="w" begin="4" end="5">A</span></p></body></tt>', None)
    cue = {'id': 'cue-1', 'text': '●●', 'anchor': {'kind': 'before', 'lineId': 'a'}, 'beginMs': 3000, 'endMs': 3900}
    snapshot['karaoke']['cues'] = [cue]
    snapshot['karaoke']['groups'][0]['name'] = 'Custom'
    snapshot['karaoke']['singerMarkers'] = [{'agentIds': ['a', 'b'], 'skip': True, 'trigger': 'Duet', 'beforeImage': 'external.png', 'afterImage': '', 'sizeMode': 'Zoom', 'zoom': '1', 'noDecor': True, 'forceWipeDecor': False, 'marginLeft': 0, 'marginRight': -170, 'marginBottom': 0}]
    headers = {'origin': 'http://studio', 'if-match': before.headers['etag']}
    body = {'schema_version': 'studio-document-v9', 'project_id': 'p', 'revision': before.json()['revision'], 'document': snapshot}
    invalid = deepcopy(body)
    invalid['document']['karaoke']['cues'].append(cue)
    assert client.put('/api/v1/projects/p/document', json=invalid, headers=headers).status_code == 422
    invalid = deepcopy(body)
    invalid['document']['karaoke']['singerMarkers'].append({**snapshot['karaoke']['singerMarkers'][0], 'agentIds': ['b', 'a']})
    assert client.put('/api/v1/projects/p/document', json=invalid, headers=headers).status_code == 422
    saved = client.put('/api/v1/projects/p/document', json=body, headers=headers)
    assert saved.status_code == 200, saved.text
    reopened = client.get('/api/v1/projects/p/document').json()['document']
    assert reopened['karaoke'] == snapshot['karaoke']
    assert '●' not in reopened['lyrics']['draftTtml']
    # Retiming may leave a cue outside its anchor. Draft persistence must retain it for repair.
    snapshot['karaoke']['cues'][0]['endMs'] = 4500
    current = client.get('/api/v1/projects/p/document')
    body.update(revision=current.json()['revision'], document=snapshot)
    headers['if-match'] = current.headers['etag']
    assert client.put('/api/v1/projects/p/document', json=body, headers=headers).status_code == 200
