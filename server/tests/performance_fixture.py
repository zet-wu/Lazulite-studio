"""Temporary FastAPI projects for opt-in production performance checks."""
import os
import subprocess
from pathlib import Path
from tempfile import TemporaryDirectory

from server.app import create_app
from server.auth import Settings
from server.db import Database
from server.revisions import RevisionStore
from server.tests.media_fixture import add_media_project, add_real_vocal_fixture


def create_performance_app():
    temporary = TemporaryDirectory(prefix="studio-performance-")
    root = Path(temporary.name)
    db = Database(root / "studio.sqlite3")
    store = RevisionStore(db, root / "projects")
    synthetic = root / "synthetic.wav"
    subprocess.run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=640.123", "-ac", "2", str(synthetic)], check=True)
    sources = {"synthetic": synthetic}
    if os.environ.get("STUDIO_PERF_AUDIO"):
        sources["real"] = Path(os.environ["STUDIO_PERF_AUDIO"])
    for project_id, source in sources.items():
        add_media_project(root, db, store, project_id, source, '<tt xmlns="http://www.w3.org/ns/ttml"><body><div><p begin="1" end="5"><span begin="1" end="5">合成歌词</span></p></div></body></tt>')
    add_real_vocal_fixture(root, db, store)
    app = create_app(root, Settings(None, True, "http://127.0.0.1:5176"))
    app.add_event_handler("shutdown", temporary.cleanup)
    return app
