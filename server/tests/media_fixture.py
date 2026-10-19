from server.project_document import initial_project, read_lyrics
"""Media-backed projects in disposable test databases."""
import json
from pathlib import Path
from server.db import Database
from server.revisions import RevisionStore
from server.studio.media import MediaService


def add_media_project(root: Path, db: Database, store: RevisionStore, project_id: str, source: Path, ttml: str):
    media = MediaService(root / 'projects' / project_id)
    asset = media.import_asset(source)
    proxy = media.playback_proxy(asset)
    metadata = json.dumps({"codec": asset.probe.codec, "container": asset.probe.container, "proxy_offset_ms": proxy.offset_ms, "proxy_duration_ms": proxy.duration_ms})
    with db.transaction() as connection:
        connection.execute("INSERT OR IGNORE INTO assets VALUES(?,?,?,?,?,?,?,?,?,?,?,?)", (project_id, asset.content_hash, asset.size, asset.probe.mime_type, asset.original_name, 1, asset.probe.duration_ms, asset.probe.start_ms, asset.probe.sample_rate, asset.probe.channels, metadata, "now"))
        connection.execute("INSERT INTO projects VALUES(?,?,?,?,?,?)", (project_id, project_id, project_id, None, "now", "now"))
    store.create(project_id, initial_project(ttml, asset.content_hash), None)


def add_real_vocal_fixture(root, db, store):
    import os, shutil
    if not os.getenv('STUDIO_VOCAL_REAL_ROOT'): return
    source_root = Path(os.environ['STUDIO_VOCAL_REAL_ROOT'])
    source_db = Database(source_root/'studio.sqlite3')
    with source_db.connect() as c:
        result = c.execute("SELECT * FROM vocal_results WHERE id='actual-demucs'").fetchone()
    metadata = json.loads(result['metadata_json'])
    source = source_root/'projects'/'real'/'source'/'original'
    add_media_project(root, db, store, 'real-vocal', source, '<tt xmlns="http://www.w3.org/ns/ttml"><body><div><p xml:id="u">真实人声人工分配</p></div></body></tt>')
    directory = root/'projects'/'real-vocal'/'vocals'/'actual-demucs'
    shutil.copytree(source_db.paths.resolve(result['directory']), directory)
    metadata['source_asset_id'] = 'real-vocal'
    with db.transaction() as c:
        c.execute('INSERT INTO vocal_results VALUES(?,?,?,?,?,?)', ('actual-demucs','real-vocal','real-vocal','ready',db.paths.store(directory),json.dumps(metadata)))
