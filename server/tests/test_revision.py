from server.project_document import initial_project, read_lyrics
from pathlib import Path
from server.time_units import normalize_ttml

from server.db import Database
from server.revisions import IdempotencyConflict, RevisionConflict, RevisionStore


def test_revision_cas_and_recovery(tmp_path: Path):
    db = Database(tmp_path / "db.sqlite")
    store = RevisionStore(db, tmp_path / "projects")
    with db.transaction() as conn:
        conn.execute(
            "INSERT INTO projects VALUES(?,?,?,?,?,?)",
            ("p", "demo", None, None, "now", "now"),
        )
    first = store.create("p", initial_project("<tt xmlns=\"http://www.w3.org/ns/ttml\"><p>one</p></tt>", None), None)
    try:
        store.create("p", initial_project("<tt xmlns=\"http://www.w3.org/ns/ttml\"><p>bad</p></tt>", None), None)
    except RevisionConflict as exc:
        assert exc.current == first["id"]
    else:
        raise AssertionError("CAS must reject stale base")
    (tmp_path / "projects" / "p" / "revisions" / "orphan.json").write_text("partial")
    store.recover()
    assert not (tmp_path / "projects" / "p" / "revisions" / "orphan.json").exists()
    before = store.read("p")
    with db.transaction() as conn:
        conn.execute(
            "CREATE TRIGGER reject_revision_update BEFORE UPDATE OF current_revision ON projects BEGIN SELECT RAISE(ABORT, 'blocked'); END"
        )
    try:
        store.create("p", initial_project("<tt xmlns=\"http://www.w3.org/ns/ttml\"><p>blocked</p></tt>", None), first["id"])
    except Exception:
        pass
    with db.connect() as conn:
        assert (
            conn.execute(
                "SELECT current_revision FROM projects WHERE id='p'"
            ).fetchone()[0]
            == first["id"]
        )
    assert store.read("p") == before


def test_initial_revision_replays_identity_after_old_snapshot_is_collected(
    tmp_path: Path,
):
    db = Database(tmp_path / "db.sqlite")
    store = RevisionStore(db, tmp_path / "projects")
    with db.transaction() as conn:
        conn.execute(
            "INSERT INTO projects VALUES(?,?,?,?,?,?)",
            ("p", "demo", None, None, "now", "now"),
        )
    first = store.create_initial("p", operation_id="op-1", subject="user")
    assert store.create_initial("p", operation_id="op-1", subject="user") == first
    try:
        store.create(
            "p",
            initial_project("<tt xmlns=\"http://www.w3.org/ns/ttml\"><p>other</p></tt>", None),
            first["id"],
            operation_id="op-1",
            subject="user",
        )
    except IdempotencyConflict:
        pass
    else:
        raise AssertionError("same operation must reject different content")
    with db.connect() as conn:
        assert conn.execute("SELECT count(*) FROM revisions").fetchone()[0] == 1
    second = store.create(
        "p", initial_project("<tt xmlns=\"http://www.w3.org/ns/ttml\"><p>two</p></tt>", None), first["id"], operation_id="op-2", subject="user"
    )
    store.recover()
    assert second["id"] != first["id"]
    assert "two" in store.read("p")[1]["lyrics"]["draftTtml"]
    assert store.create_initial("p", operation_id="op-1", subject="user") == first
    with db.connect() as conn:
        assert conn.execute("SELECT count(*) FROM revisions").fetchone()[0] == 1


def test_revision_without_idempotency_uses_revision_identity(tmp_path, monkeypatch):
    import server.revisions as revisions
    from server.documents import DocumentService
    db = Database(tmp_path / 'db.sqlite')
    store = RevisionStore(db, tmp_path / 'projects')
    with db.transaction() as conn:
        conn.execute('INSERT INTO projects VALUES(?,?,?,?,?,?)', ('p','demo',None,None,'now','now'))
    def no_content_digest(*args, **kwargs):
        raise AssertionError('plain save and document reads only need revision identity')
    monkeypatch.setattr(revisions.hashlib, 'sha256', no_content_digest)
    result = store.create('p', initial_project('<tt xmlns="http://www.w3.org/ns/ttml"><body><div/></body></tt>', None), None)
    assert 'sha256' not in result
    document = DocumentService(store).get('p')
    assert document['revision'] == result['id']
    assert document['etag'] == result['etag']
    assert 'sha256' not in document


def test_read_transaction_protects_file_until_snapshot_is_loaded(tmp_path, monkeypatch):
    import threading
    from concurrent.futures import ThreadPoolExecutor
    import server.revisions as module
    db = Database(tmp_path / 'db.sqlite'); store = RevisionStore(db, tmp_path / 'projects')
    with db.transaction() as c: c.execute('INSERT INTO projects VALUES(?,?,?,?,?,?)', ('p','p',None,None,'now','now'))
    first = store.create_initial('p', operation_id='init')['id']
    started, release, writing = threading.Event(), threading.Event(), threading.Event()
    original = module.read_project
    def read(path):
        started.set()
        assert release.wait(5)
        return original(path)
    monkeypatch.setattr(module, 'read_project', read)
    def save():
        writing.set()
        return store.create('p', initial_project('<tt xmlns="http://www.w3.org/ns/ttml"><body><p>new</p></body></tt>',None), first)
    with ThreadPoolExecutor(2) as pool:
        reader = pool.submit(store.read, 'p')
        assert started.wait(2)
        writer = pool.submit(save)
        assert writing.wait(2)
        try:
            assert not writer.done()
            assert (tmp_path/'projects/p/revisions'/f'{first}.json').exists()
        finally: release.set()
        assert reader.result()[0] == first
        current = writer.result()['id']
    assert {p.stem for p in (tmp_path/'projects/p/revisions').glob('*.json')} == {current}
