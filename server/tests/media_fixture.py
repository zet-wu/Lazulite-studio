"""Media-backed projects in disposable test databases."""
import json
from pathlib import Path
from server.db import Database
from server.revisions import RevisionStore
from server.studio.media import MediaService


def add_media_project(root: Path, db: Database, store: RevisionStore, project_id: str, source: Path, ttml: str):
    media = MediaService(root)
    asset = media.import_asset(source)
    proxy = media.playback_proxy(asset)
    metadata = json.dumps({"codec": asset.probe.codec, "container": asset.probe.container, "proxy_offset_us": proxy.offset_us, "proxy_duration_us": proxy.duration_us})
    with db.transaction() as connection:
        connection.execute("INSERT OR IGNORE INTO assets VALUES(?,?,?,?,?,?,?,?,?,?,?,?)", (asset.content_hash, asset.content_hash, asset.size, asset.probe.mime_type, asset.original_name, 1, asset.probe.duration_us, asset.probe.start_us, asset.probe.sample_rate, asset.probe.channels, metadata, "now"))
        connection.execute("INSERT INTO projects VALUES(?,?,?,?,?,?)", (project_id, project_id, asset.content_hash, None, "now", "now"))
    store.create(project_id, ttml, None)
