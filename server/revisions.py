from __future__ import annotations

import hashlib
import json
import logging
import os
import shutil
import tempfile
import uuid
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path

from .db import Database
from .review_fingerprint import fingerprints
from .project_document import initial_project, validate_project, read_project, read_lyrics

INITIAL_TTML = '<tt xmlns="http://www.w3.org/ns/ttml"><body><div/></body></tt>'
logger = logging.getLogger(__name__)


class RevisionConflict(Exception):
    def __init__(self, current: str | None):
        self.current = current


class IdempotencyConflict(Exception):
    pass


class RevisionStore:
    def __init__(self, db: Database, root: str | Path):
        self.db, self.root = db, Path(root)
        self.root.mkdir(parents=True, exist_ok=True)

    def create_initial(
        self, project_id: str, *, operation_id: str, subject: str = "local"
    ) -> dict:
        with self.db.connect() as conn:
            row = conn.execute('SELECT source_asset_id FROM projects WHERE id=?', (project_id,)).fetchone()
        if row is None: raise KeyError(project_id)
        return self.create(project_id, initial_project(INITIAL_TTML, row[0]), None,
                           operation_id=operation_id, subject=subject)

    def create(
        self,
        project_id: str,
        snapshot: dict,
        base: str | None,
        *,
        operation_id: str | None = None,
        subject: str = "local",
        client_seq: int | None = None,
    ) -> dict:
        with self.db.connect() as conn:
            snapshot = validate_project(snapshot, conn, project_id)
        ttml = snapshot['lyrics']['draftTtml']
        encoded = json.dumps(snapshot, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()
        digest = hashlib.sha256(encoded).hexdigest()
        request_hash = hashlib.sha256(
            json.dumps(
                [subject, project_id, base, digest, client_seq], separators=(",", ":")
            ).encode()
        ).hexdigest()
        now = datetime.now(timezone.utc).isoformat()
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
                "SELECT current_revision FROM projects WHERE id=?", (project_id,)
            ).fetchone()
            if row is None:
                raise KeyError(project_id)
            if row[0] != base:
                raise RevisionConflict(row[0])
            revision = uuid.uuid4().hex
            path = self.root / f"{revision}.json"
            self._write_atomic(path, encoded)
            try:
                conn.execute(
                    "INSERT INTO revisions(id,project_id,parent_id,project_path,created_at) VALUES(?,?,?,?,?)",
                    (revision, project_id, base, str(path), now),
                )
                if (
                    conn.execute(
                        "UPDATE projects SET current_revision=?,updated_at=? WHERE id=? AND current_revision IS ?",
                        (revision, now, project_id, base),
                    ).rowcount
                    != 1
                ):
                    raise RevisionConflict(row[0])
                # Confirmations belong to a precise lyric revision. A saved
                # document makes prior confirmations stale atomically.
                old_hashes = {}
                if base:
                    old_row = conn.execute("SELECT project_path FROM revisions WHERE id=?", (base,)).fetchone()
                    if old_row:
                        old_root = ET.fromstring(read_lyrics(old_row[0]))
                        confirmed_ids = [row[0] for row in conn.execute("SELECT line_id FROM review_confirmations WHERE project_id=? AND status='confirmed'", (project_id,)).fetchall()]
                        old_fingerprints = fingerprints(old_root)
                        old_hashes = {line_id: old_fingerprints.get(line_id) for line_id in confirmed_ids}
                new_root = ET.fromstring(ttml.encode())
                new_fingerprints = fingerprints(new_root)
                confirmed = conn.execute("SELECT line_id,content_hash FROM review_confirmations WHERE project_id=? AND status='confirmed'", (project_id,)).fetchall()
                review_changed = False
                for item in confirmed:
                    if old_hashes.get(item[0]) == new_fingerprints.get(item[0]) == item[1]:
                        conn.execute("UPDATE review_confirmations SET revision=? WHERE project_id=? AND line_id=?", (revision, project_id, item[0]))
                        review_changed = True
                    else:
                        conn.execute("UPDATE review_confirmations SET status='stale' WHERE project_id=? AND line_id=?", (project_id, item[0]))
                        review_changed = True
                if review_changed:
                    conn.execute("INSERT INTO review_versions(project_id,version) VALUES(?,1) ON CONFLICT(project_id) DO UPDATE SET version=version+1", (project_id,))
                result = {
                    "id": revision,
                    "etag": f'"{revision}"',
                    "sha256": digest,
                    "created_at": now,
                }
                if client_seq is not None:
                    result["client_seq"] = client_seq
                if operation_id:
                    conn.execute(
                        "INSERT INTO idempotency VALUES(?,?,?,?,?)",
                        (operation_id, subject, request_hash, json.dumps(result), now),
                    )
            except Exception:
                path.unlink(missing_ok=True)
                raise
        try:
            self.materialize_current(project_id)
        except OSError:
            logger.warning(
                "revision committed but draft materialization failed",
                extra={"project_id": project_id, "revision": result["id"]},
            )
        return result

    def read(self, project_id: str, revision: str | None = None) -> tuple[str, dict]:
        """Read an immutable revision and return (revision id, project snapshot)."""
        with self.db.connect() as conn:
            row = conn.execute(
                "SELECT p.current_revision, r.id, r.project_path FROM projects p "
                "JOIN revisions r ON r.project_id=p.id AND r.id=COALESCE(?, p.current_revision) "
                "WHERE p.id=?",
                (revision, project_id),
            ).fetchone()
        if row is None:
            raise KeyError(project_id if revision is None else revision)
        path = Path(row[2]).resolve()
        root = self.root.resolve()
        if root not in path.parents or path.suffix != ".json":
            raise ValueError("revision path is outside revision store")
        try:
            return row[1], read_project(path)
        except (OSError, UnicodeError) as exc:
            raise ValueError("revision cannot be read") from exc

    def _write_atomic(self, destination: Path, content: bytes) -> None:
        fd, name = tempfile.mkstemp(
            prefix=f".{destination.name}-", dir=destination.parent
        )
        temporary = Path(name)
        try:
            with os.fdopen(fd, "wb") as handle:
                handle.write(content)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary, destination)
            self._fsync_dir(destination.parent)
        finally:
            temporary.unlink(missing_ok=True)

    def _materialize(self, project_id: str, source: Path) -> None:
        destination = self.root / f"{project_id}.draft.json"
        fd, name = tempfile.mkstemp(prefix=f".{project_id}.draft-", dir=self.root)
        temporary = Path(name)
        try:
            with os.fdopen(fd, "wb") as handle, source.open("rb") as input_file:
                shutil.copyfileobj(input_file, handle)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary, destination)
            self._fsync_dir(self.root)
        finally:
            temporary.unlink(missing_ok=True)

    def materialize_current(self, project_id: str) -> None:
        """Materialize the revision currently pointed to, under the DB write lock."""
        with self.db.transaction() as conn:
            row = conn.execute(
                "SELECT r.project_path FROM projects p JOIN revisions r ON r.id=p.current_revision WHERE p.id=?",
                (project_id,),
            ).fetchone()
            if row is None:
                raise KeyError(project_id)
            self._materialize(project_id, Path(row[0]))

    @staticmethod
    def _fsync_dir(path: Path) -> None:
        fd = os.open(path, os.O_RDONLY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)

    def recover(self) -> None:
        with self.db.connect() as conn:
            revisions = {
                row[0]: row[1]
                for row in conn.execute("SELECT id,project_path FROM revisions")
            }
            rows = conn.execute(
                "SELECT id,current_revision FROM projects WHERE current_revision IS NOT NULL"
            ).fetchall()
            for path in self.root.glob("*.json"):
                if not path.name.endswith(".draft.json") and path.stem not in revisions:
                    path.unlink(missing_ok=True)
        for row in rows:
            self.materialize_current(row[0])
