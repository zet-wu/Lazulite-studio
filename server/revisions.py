from __future__ import annotations

import hashlib
import json
import logging
import os
import shutil
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path

from .db import Database

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
        return self.create(
            project_id, INITIAL_TTML, None, operation_id=operation_id, subject=subject
        )

    def create(
        self,
        project_id: str,
        ttml: str,
        base: str | None,
        *,
        operation_id: str | None = None,
        subject: str = "local",
    ) -> dict:
        digest = hashlib.sha256(ttml.encode()).hexdigest()
        request_hash = hashlib.sha256(
            json.dumps(
                [subject, project_id, base, digest], separators=(",", ":")
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
            path = self.root / f"{revision}.ttml"
            self._write_atomic(path, ttml.encode())
            try:
                conn.execute(
                    "INSERT INTO revisions(id,project_id,parent_id,ttml_path,created_at) VALUES(?,?,?,?,?)",
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
                result = {
                    "id": revision,
                    "etag": f'"{revision}"',
                    "sha256": digest,
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
        try:
            self.materialize_current(project_id)
        except OSError:
            logger.warning(
                "revision committed but draft materialization failed",
                extra={"project_id": project_id, "revision": result["id"]},
            )
        return result

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
        destination = self.root / f"{project_id}.draft.ttml"
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
                "SELECT r.ttml_path FROM projects p JOIN revisions r ON r.id=p.current_revision WHERE p.id=?",
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
                for row in conn.execute("SELECT id,ttml_path FROM revisions")
            }
            rows = conn.execute(
                "SELECT id,current_revision FROM projects WHERE current_revision IS NOT NULL"
            ).fetchall()
            for path in self.root.glob("*.ttml"):
                if not path.name.endswith(".draft.ttml") and path.stem not in revisions:
                    path.unlink(missing_ok=True)
        for row in rows:
            self.materialize_current(row[0])
