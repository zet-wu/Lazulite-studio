from __future__ import annotations

import hashlib
import json
import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path

from .atomic_file import write_atomic
from .db import Database
from .project_document import ProjectSnapshot, load_project, validate_project

INITIAL_TTML = '<tt xmlns="http://www.w3.org/ns/ttml"><body><div/></body></tt>'
logger = logging.getLogger(__name__)


class RevisionConflict(Exception):
    def __init__(self, current: str | None):
        self.current = current


class IdempotencyConflict(Exception):
    pass


class RevisionStore:
    def __init__(self, db: Database, root: str | Path, event_hub=None):
        self.db, self.root, self.event_hub = db, Path(root), event_hub
        self.root.mkdir(parents=True, exist_ok=True)

    def create(
        self,
        project_id: str,
        snapshot: dict | ProjectSnapshot,
        base: str | None,
        *,
        operation_id: str | None = None,
        subject: str = "local",
        client_seq: int | None = None,
    ) -> dict:
        with self.db.connect() as conn:
            snapshot = validate_project(snapshot, conn, project_id)
        encoded = json.dumps(snapshot, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()
        if operation_id:
            digest = hashlib.sha256(encoded).hexdigest()
            request_hash = hashlib.sha256(
                json.dumps(
                    [subject, project_id, base, digest, client_seq], separators=(",", ":")
                ).encode()
            ).hexdigest()
        now = datetime.now(timezone.utc).isoformat()
        with self.db.project_write(project_id):
            with self.db.transaction() as conn:
                if operation_id:
                    old = conn.execute(
                        "SELECT response,request_hash FROM idempotency WHERE key=?",
                        (operation_id,),
                    ).fetchone()
                    if old:
                        if old[1] != request_hash:
                            raise IdempotencyConflict(operation_id)
                        return json.loads(old[0])
                row = conn.execute(
                    "SELECT current_revision, source_asset_id FROM projects WHERE id=?", (project_id,)
                ).fetchone()
                if row is None:
                    raise KeyError(project_id)
                if row[0] != base:
                    raise RevisionConflict(row[0])
                source_asset_id = row[1]
                revision = uuid.uuid4().hex
                path = self.root / project_id / "revisions" / f"{revision}.json"
                write_atomic(path, encoded)
                try:
                    conn.execute(
                        "INSERT INTO revisions(id,project_id,parent_id,project_path,created_at) VALUES(?,?,?,?,?)",
                        (revision, project_id, base, self.db.paths.store(path), now),
                    )
                    if (
                        conn.execute(
                            "UPDATE projects SET current_revision=?,updated_at=? WHERE id=? AND current_revision IS ?",
                            (revision, now, project_id, base),
                        ).rowcount
                        != 1
                    ):
                        raise RevisionConflict(row[0])
                    result = {
                        "id": revision,
                        "etag": f'"{revision}"',
                        "created_at": now,
                    }
                    if operation_id:
                        conn.execute(
                            "INSERT INTO idempotency VALUES(?,?,?,?,?)",
                            (operation_id, subject, request_hash, json.dumps(result), now),
                        )
                except Exception:
                    path.unlink(missing_ok=True)
                    raise
            try: self._collect_unlocked(project_id)
            except OSError: logger.warning('修订回收待重试：%s', project_id, exc_info=True)
        if self.event_hub is not None:
            self.event_hub.publish(project_id, "revision_changed", revision=revision, source_asset_id=source_asset_id)
        return result

    def collect(self, project_id: str) -> None:
        """Keep current snapshots and inputs still used by active jobs."""
        with self.db.project_write(project_id):
            self._collect_unlocked(project_id)

    def _collect_unlocked(self, project_id: str) -> None:
        paths = []
        with self.db.transaction() as conn:
            rows = conn.execute('SELECT id,project_path FROM revisions WHERE project_id=?', (project_id,)).fetchall()
            current = conn.execute('SELECT current_revision FROM projects WHERE id=?', (project_id,)).fetchone()
            if not current: return
            protected = {current[0]}
            for job in conn.execute("SELECT request_json FROM jobs WHERE project_id=? AND kind='alignment' AND status IN ('queued','running','cancel_requested')", (project_id,)):
                request = json.loads(job[0])
                protected.add(request.get('revision'))
            for row in rows:
                if row[0] not in protected:
                    conn.execute('UPDATE revisions SET parent_id=NULL WHERE parent_id=?', (row[0],))
                    conn.execute('DELETE FROM revisions WHERE id=?', (row[0],))
                    paths.append(self.db.paths.resolve(row[1]))
        for path in paths:
            try: path.unlink(missing_ok=True)
            except OSError: logger.warning('修订文件回收待重试：%s', path)

    def read(self, project_id: str, revision: str | None = None) -> tuple[str, dict]:
        revision_id, snapshot, _ = self.read_bound(project_id, revision)
        return revision_id, snapshot

    def read_bound(self, project_id: str, revision: str | None = None) -> tuple[str, dict, str | None]:
        """Read an immutable revision and return (revision id, project snapshot)."""
        with self.db.project_read(project_id):
            with self.db.connect() as conn:
                row = conn.execute(
                    "SELECT p.current_revision, r.id, r.project_path, p.source_asset_id FROM projects p "
                    "JOIN revisions r ON r.project_id=p.id AND r.id=COALESCE(?, p.current_revision) "
                    "WHERE p.id=?",
                    (revision, project_id),
                ).fetchone()
                if row is None:
                    raise KeyError(project_id if revision is None else revision)
                path = self.db.paths.resolve(row[2])
                root = self.root.resolve()
                if root not in path.parents or path.suffix != ".json":
                    raise ValueError("revision path is outside revision store")
            try:
                return row[1], load_project(path), row[3]
            except (OSError, UnicodeError, json.JSONDecodeError) as exc:
                raise ValueError("revision cannot be read") from exc

    def recover(self) -> None:
        with self.db.transaction() as conn:
            revisions = {
                row[0]: row[1]
                for row in conn.execute("SELECT id,project_path FROM revisions")
            }
            rows = conn.execute(
                "SELECT id,current_revision FROM projects WHERE current_revision IS NOT NULL"
            ).fetchall()
            for path in self.root.glob("*/revisions/*.json"):
                if path.stem not in revisions:
                    try: path.unlink(missing_ok=True)
                    except OSError: logger.warning('孤立修订回收待重试：%s', path)
        for temporary in self.root.glob('*/revisions/.*'):
            if temporary.is_file(): temporary.unlink(missing_ok=True)
        for row in rows:
            self.collect(row[0])
