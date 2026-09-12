import hashlib
import time

from fastapi.testclient import TestClient

from server.app import create_app
from server.auth import Settings
from server.db import Database
from server.reading import ReadingDictionary, ReadingJobRunner, ReadingProposal, SudachiReadingProposer


def seed_revision(db, tmp_path, revision, text):
    path = tmp_path / f"{revision}.ttml"
    path.write_text(
        f'<tt xmlns="http://www.w3.org/ns/ttml"><body><p xml:id="line">{text}</p></body></tt>',
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
    source_hash = hashlib.sha256((tmp_path / "r1.ttml").read_bytes()).hexdigest()
    proposals = ReadingJobRunner(db, SudachiReadingProposer()).run(
        "project", {"revision": "r1", "asset_id": "asset"}
    )["proposals"]
    assert [(item["base"], item["reading"], item["source"]) for item in proposals] == [
        ("宇宙", "そら", "dictionary")
    ]
    assert hashlib.sha256((tmp_path / "r1.ttml").read_bytes()).hexdigest() == source_hash


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
