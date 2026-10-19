from __future__ import annotations

import sqlite3
from pathlib import Path
from contextlib import contextmanager
from typing import Iterator

SCHEMA = """
CREATE TABLE IF NOT EXISTS projects (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, source_asset_id TEXT, current_revision TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS search_conditions (
 project_id TEXT PRIMARY KEY, title TEXT NOT NULL, artist TEXT NOT NULL, album TEXT NOT NULL,
 FOREIGN KEY(project_id) REFERENCES projects(id)
);
CREATE TABLE IF NOT EXISTS assets (
 id TEXT PRIMARY KEY, sha256 TEXT NOT NULL, size INTEGER NOT NULL,
 mime TEXT NOT NULL, filename TEXT, playable INTEGER NOT NULL DEFAULT 0,
 duration_ms INTEGER, start_ms INTEGER, sample_rate INTEGER, channels INTEGER,
 metadata TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS revisions (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL, parent_id TEXT, project_path TEXT NOT NULL,
 created_at TEXT NOT NULL, FOREIGN KEY(project_id) REFERENCES projects(id)
);
CREATE TABLE IF NOT EXISTS vocal_results (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL, source_asset_id TEXT NOT NULL,
 status TEXT NOT NULL, directory TEXT NOT NULL, metadata_json TEXT NOT NULL,
 FOREIGN KEY(project_id) REFERENCES projects(id)
);
CREATE TABLE IF NOT EXISTS idempotency (
 key TEXT PRIMARY KEY, subject TEXT NOT NULL, request_hash TEXT NOT NULL, response TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, expires_at TEXT NOT NULL, revoked INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS jobs (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL, kind TEXT NOT NULL, status TEXT NOT NULL,
 request_json TEXT NOT NULL, result_json TEXT, error_json TEXT, engine_json TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, started_at TEXT, finished_at TEXT,
 cancel_requested INTEGER NOT NULL DEFAULT 0, stage TEXT,
 FOREIGN KEY(project_id) REFERENCES projects(id)
);
CREATE INDEX IF NOT EXISTS jobs_project_created ON jobs(project_id, created_at DESC);
CREATE TABLE IF NOT EXISTS job_idempotency (
 project_id TEXT NOT NULL, idem_key TEXT NOT NULL, request_hash TEXT NOT NULL, job_id TEXT NOT NULL,
 PRIMARY KEY(project_id, idem_key), FOREIGN KEY(job_id) REFERENCES jobs(id)
);
"""


class Database:
    def __init__(self, path: str | Path):
        self.path = str(Path(path).resolve())
        from .storage_paths import StoragePaths
        self.paths = StoragePaths(Path(self.path).parent)
        Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as conn:
            version = conn.execute('PRAGMA user_version').fetchone()[0]
            if version != 6 and conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='projects'").fetchone():
                raise RuntimeError('旧项目存储不兼容（需要 v6）；请使用当前格式的资料库')
            conn.executescript(SCHEMA)
            conn.execute('PRAGMA user_version=6')

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        conn = sqlite3.connect(self.path, timeout=10, isolation_level=None)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys=ON")
        try:
            yield conn
        finally:
            conn.close()

    @contextmanager
    def transaction(self) -> Iterator[sqlite3.Connection]:
        with self.connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            try:
                yield conn
                conn.commit()
            except Exception:
                conn.rollback()
                raise
