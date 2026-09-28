"""Temporary project server for the browser save/reopen integration test."""
from pathlib import Path
from tempfile import TemporaryDirectory

from server.app import create_app
from server.auth import Settings
from server.db import Database
from server.revisions import RevisionStore


def create_browser_app():
    temporary = TemporaryDirectory(prefix="studio-browser-")
    root = Path(temporary.name)
    db = Database(root / "studio.sqlite3")
    store = RevisionStore(db, root / "revisions")
    with db.transaction() as connection:
        connection.execute("INSERT INTO projects VALUES(?,?,?,?,?,?)", ("phase2", "浏览器集成项目", None, None, "now", "now"))
    fixture = Path(__file__).resolve().parents[2] / "tests/fixtures/ttml/phase2-multitrack.ttml"
    store.create("phase2", fixture.read_text(encoding="utf-8"), None)
    app = create_app(root, Settings(None, True, "http://127.0.0.1:5175"))
    app.add_event_handler("shutdown", temporary.cleanup)
    return app
