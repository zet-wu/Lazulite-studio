from server.project_document import initial_project, read_lyrics
"""Temporary project server for the browser save/reopen integration test."""
import subprocess
from pathlib import Path
from tempfile import TemporaryDirectory

from server.app import create_app
from server.auth import Settings
from server.db import Database
from server.revisions import RevisionStore
from server.tests.media_fixture import add_media_project


def create_browser_app():
    temporary = TemporaryDirectory(prefix="studio-browser-")
    root = Path(temporary.name)
    db = Database(root / "studio.sqlite3")
    store = RevisionStore(db, root / "revisions")
    with db.transaction() as connection:
        connection.execute("INSERT INTO projects VALUES(?,?,?,?,?,?)", ("phase2", "浏览器集成项目", None, None, "now", "now"))
    fixture = Path(__file__).resolve().parents[2] / "tests/fixtures/ttml/phase2-multitrack.ttml"
    store.create("phase2", initial_project(fixture.read_text(encoding="utf-8"), None), None)
    audio = root / 'offset.m4a'
    subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=8.123', '-af', 'asetpts=PTS+2/TB', '-c:a', 'aac', str(audio)], check=True)
    ttml = '<tt xmlns="http://www.w3.org/ns/ttml"><body><div>' + ''.join(f'<p xml:id="media-{i}" begin="1.123" end="3.985"><span begin="1.123" end="3.985">合成媒体行{i}</span></p>' for i in range(3)) + '</div></body></tt>'
    add_media_project(root, db, store, 'phase3-media', audio, ttml)
    long_audio = root / 'long-background.m4a'
    subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=220:sample_rate=48000:duration=132', '-c:a', 'aac', str(long_audio)], check=True)
    add_media_project(root, db, store, 'phase4-background', long_audio,
        '<tt xmlns="http://www.w3.org/ns/ttml"><body><p begin="1" end="2">合成占位</p></body></tt>')
    add_media_project(root, db, store, 'phase0-packaging', audio, ttml)
    app = create_app(root, Settings(None, True, "http://127.0.0.1:5175"))
    app.add_event_handler("shutdown", temporary.cleanup)
    return app
