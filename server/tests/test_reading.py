import json
from server.project_document import initial_project
import hashlib
import time

from fastapi.testclient import TestClient

from server.app import create_app
from server.auth import Settings
from server.db import Database
from server.reading import ReadingDictionary, ReadingJobRunner, ReadingProposal, SudachiReadingProposer


def seed_revision(db, tmp_path, revision, text):
    path = tmp_path / f"{revision}.json"
    path.write_text(
        json.dumps(initial_project(f'<tt xmlns="http://www.w3.org/ns/ttml"><body><p xml:id="line">{text}</p></body></tt>', "asset")),
        encoding="utf-8",
    )
    with db.transaction() as conn:
        conn.execute(
            "INSERT INTO revisions VALUES(?,?,?,?,?)",
            (revision, "project", None, str(path), "t"),
        )


def seed_project(db):
    with db.transaction() as conn:
        conn.execute(
            "INSERT INTO assets VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
            ("asset", "a" * 64, 1, "audio/wav", "x", 1, 1, 0, 1, 1, "{}", "t"),
        )
        conn.execute(
            "INSERT INTO projects VALUES(?,?,?,?,?,?)",
            ("project", "demo", "asset", "r1", "t", "t"),
        )


def test_sudachi_uses_whole_word_and_code_point_offsets():
    proposals = SudachiReadingProposer().propose(
        [{"id": "line", "text": "𝄞今日かな"}], {}
    )
    assert [(item.base, item.base_start, item.base_end) for item in proposals] == [
        ("今日", 1, 3)
    ]


def test_dictionary_has_priority_without_modifying_ttml(tmp_path):
    db = Database(tmp_path / "studio.sqlite3")
    seed_project(db)
    seed_revision(db, tmp_path, "r1", "宇宙")
    dictionary = ReadingDictionary(db)
    dictionary.create("project", "宇宙", "そら")
    source_hash = hashlib.sha256((tmp_path / "r1.json").read_bytes()).hexdigest()
    proposals = ReadingJobRunner(db, SudachiReadingProposer()).run(
        "project", {"revision": "r1", "asset_id": "asset"}
    )["proposals"]
    assert [(item["base"], item["reading"], item["source"]) for item in proposals] == [
        ("宇宙", "そら", "dictionary")
    ]
    assert hashlib.sha256((tmp_path / "r1.json").read_bytes()).hexdigest() == source_hash


def test_reading_runner_projects_requested_old_revision(tmp_path):
    db = Database(tmp_path / "studio.sqlite3")
    seed_project(db)
    seed_revision(db, tmp_path, "r1", "今日")
    seed_revision(db, tmp_path, "r2", "明日")
    with db.transaction() as conn:
        conn.execute("UPDATE projects SET current_revision='r2' WHERE id='project'")
    result = ReadingJobRunner(db, SudachiReadingProposer()).run(
        "project", {"revision": "r1", "asset_id": "asset"}
    )
    assert result["proposals"][0]["base"] == "今日"


def test_http_reading_job_uses_server_projection_and_dictionary(tmp_path):
    class FakeProposer:
        available = True

        def propose(self, lines, dictionary):
            assert lines == [{"id": "line", "text": "今日"}]
            assert dictionary["今日"] == "きょう"
            return [ReadingProposal("line", "", 0, 2, "今日", "きょう", "dictionary", False)]

    db = Database(tmp_path / "studio.sqlite3")
    seed_project(db)
    seed_revision(db, tmp_path, "r1", "今日")
    seed_revision(db, tmp_path, "r2", "明日")
    with db.transaction() as conn:
        conn.execute("UPDATE projects SET current_revision='r2' WHERE id='project'")
    app = create_app(tmp_path, Settings(None, True, "http://studio"), reading_proposer=FakeProposer())
    with TestClient(app) as client:
        headers = {"origin": "http://studio"}
        entry = client.post("/api/v1/projects/project/reading-dictionary", json={"surface": "今日", "reading": "きょう"}, headers=headers)
        assert entry.status_code == 201
        assert client.put(
            f"/api/v1/projects/project/reading-dictionary/{entry.json()['id']}",
            json={"surface": "今日", "reading": "きょう"}, headers=headers,
        ).status_code == 200
        job = client.post(
            "/api/v1/projects/project/jobs",
            json={"kind": "reading", "params": {"revision": "r1", "asset_id": "asset", "lines": [{"id": "evil", "text": "伪造"}]}},
            headers=headers,
        ).json()
        for _ in range(100):
            snapshot = client.get(f"/api/v1/jobs/{job['id']}").json()
            if snapshot["status"] in {"succeeded", "failed"}:
                break
            time.sleep(0.01)
        result = client.get(f"/api/v1/jobs/{job['id']}/result").json()
        assert result["binding"]["revision"] == "r1"
        assert result["proposals"][0]["source"] == "dictionary"


def test_current_snapshot_analysis_has_no_project_dependency():
    from server.reading import ReadingSnapshot, analyze_snapshot
    body = ReadingSnapshot(lines=[{'id': 'main', 'text': '𝄞今日 食べる'}, {'id': 'bg', 'text': '魂'}])
    result = analyze_snapshot(body, SudachiReadingProposer())
    assert [(r.base, r.reading) for r in result.ranges if r.reading] == [('今日', 'きょう'), ('食べる', 'たべる'), ('魂', 'たましい')]
    assert result.ranges[0].base == '𝄞'
    for line in body.lines:
        assert ''.join(r.base for r in result.ranges if r.line_id == line.id) == line.text


def test_snapshot_rejects_duplicate_ids_and_surfaces_failure():
    import pytest
    from server.reading import ReadingSnapshot, analyze_snapshot, ReadingUnavailable
    with pytest.raises(ValueError, match='行标识重复'):
        analyze_snapshot(ReadingSnapshot(lines=[{'id': 'a', 'text': '今日'}] * 2), SudachiReadingProposer())
    class Unavailable:
        def propose(self, lines, dictionary):
            raise ReadingUnavailable('offline')
    with pytest.raises(ReadingUnavailable):
        analyze_snapshot(ReadingSnapshot(lines=[{'id': 'a', 'text': '今日'}]), Unavailable())


def test_snapshot_http_real_sudachi_and_no_revision_write(tmp_path):
    app = create_app(tmp_path, Settings(None, True, 'http://studio'))
    with TestClient(app) as client:
        result = client.post('/api/v1/reading/analyze', headers={'origin': 'http://studio'}, json={'lines': [{'id': 'local-unsaved', 'text': '今日、魂、食べる'}]})
        assert result.status_code == 200
        assert [r['reading'] for r in result.json()['ranges'] if r['reading']] == ['きょう', 'たましい', 'たべる']
        with Database(tmp_path / 'studio.sqlite3').connect() as conn:
            assert conn.execute('SELECT COUNT(*) FROM revisions').fetchone()[0] == 0
        assert client.post('/api/v1/reading/analyze', headers={'origin': 'http://evil'}, json={'lines': [{'id': 'a', 'text': '今日'}]}).status_code == 403


def test_shared_sudachi_accepts_concurrent_snapshot_requests():
    from concurrent.futures import ThreadPoolExecutor
    from server.reading import ReadingSnapshot, analyze_snapshot
    proposer = SudachiReadingProposer()
    body = ReadingSnapshot(lines=[{'id': 'a', 'text': '今日、食べる、魂'}] )
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(lambda _: analyze_snapshot(body, proposer), range(32)))
    assert all(result == results[0] for result in results)
