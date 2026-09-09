from pathlib import Path

from server.db import Database
from server.revisions import IdempotencyConflict, RevisionConflict, RevisionStore


def test_revision_cas_and_recovery(tmp_path: Path):
    db = Database(tmp_path / "db.sqlite")
    store = RevisionStore(db, tmp_path / "revisions")
    with db.transaction() as conn:
        conn.execute(
            "INSERT INTO projects VALUES(?,?,?,?,?,?)",
            ("p", "demo", None, None, "now", "now"),
        )
    first = store.create("p", "<tt><p>one</p></tt>", None)
    try:
        store.create("p", "<tt><p>bad</p></tt>", None)
    except RevisionConflict as exc:
        assert exc.current == first["id"]
    else:
        raise AssertionError("CAS must reject stale base")
    (tmp_path / "revisions" / "orphan.ttml").write_text("partial")
    store.recover()
    assert not (tmp_path / "revisions" / "orphan.ttml").exists()
    draft = tmp_path / "revisions" / "p.draft.ttml"
    before = draft.read_text()
    with db.transaction() as conn:
        conn.execute(
            "CREATE TRIGGER reject_revision_update BEFORE UPDATE OF current_revision ON projects BEGIN SELECT RAISE(ABORT, 'blocked'); END"
        )
    try:
        store.create("p", "<tt><p>blocked</p></tt>", first["id"])
    except Exception:
        pass
    with db.connect() as conn:
        assert (
            conn.execute(
                "SELECT current_revision FROM projects WHERE id='p'"
            ).fetchone()[0]
            == first["id"]
        )
    assert draft.read_text() == before


def test_initial_revision_is_idempotent_and_recovery_replaces_stale_draft(
    tmp_path: Path,
):
    db = Database(tmp_path / "db.sqlite")
    store = RevisionStore(db, tmp_path / "revisions")
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
            "<tt><p>other</p></tt>",
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
    draft = tmp_path / "revisions" / "p.draft.ttml"
    draft.write_text("stale")
    store.recover()
    assert (
        draft.read_text()
        == '<tt xmlns="http://www.w3.org/ns/ttml"><body><div/></body></tt>'
    )
    original_materialize = store.materialize_current
    store.materialize_current = lambda _: (_ for _ in ()).throw(OSError("disk full"))
    second = store.create(
        "p", "<tt><p>two</p></tt>", first["id"], operation_id="op-2", subject="user"
    )
    store.materialize_current = original_materialize
    store.recover()
    assert second["id"] != first["id"]
    assert draft.read_text() == "<tt><p>two</p></tt>"
    with db.connect() as conn:
        assert conn.execute("SELECT count(*) FROM revisions").fetchone()[0] == 2
