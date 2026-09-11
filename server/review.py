from __future__ import annotations

from typing import Callable
from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from .db import Database
from .review_fingerprint import fingerprints


class ReviewPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    line_id: str = Field(min_length=1, max_length=200)
    confirmed: bool
    note: str | None = Field(default=None, max_length=2000)
    document_revision: str = Field(min_length=1, max_length=200)


def build_router(db: Database, *, auth: Callable, write: Callable,
                 project_exists: Callable[[str], object], stamp: Callable) -> APIRouter:
    router = APIRouter()

    @router.get("/projects/{pid}/review")
    def get_review(pid: str, _: object = Depends(auth)):
        project_exists(pid)
        with db.connect() as c:
            rows = c.execute("SELECT line_id,revision,status,note,updated_at FROM review_confirmations WHERE project_id=?", (pid,)).fetchall()
            version = c.execute("SELECT version FROM review_versions WHERE project_id=?", (pid,)).fetchone()
        return {"schema_version": "studio-review-v1", "project_id": pid, "version": version[0] if version else 0, "items": [dict(r) for r in rows]}

    @router.patch("/projects/{pid}/review")
    def patch_review(pid: str, body: ReviewPatch, if_match: str | None = Header(default=None, alias="If-Match"), _: object = Depends(write)):
        project_exists(pid)
        with db.transaction() as c:
            revision = c.execute("SELECT current_revision FROM projects WHERE id=?", (pid,)).fetchone()[0]
            if body.document_revision != revision:
                raise HTTPException(412, {"code": "revision_conflict", "message": "document revision is stale", "retryable": False})
            current = c.execute("SELECT version FROM review_versions WHERE project_id=?", (pid,)).fetchone()
            version = current[0] if current else 0
            if if_match is None or if_match.strip('"') != str(version):
                raise HTTPException(412, {"code": "review_conflict", "message": "review version is stale", "retryable": False})
            path = c.execute("SELECT ttml_path FROM revisions WHERE id=? AND project_id=?", (revision, pid)).fetchone()[0]
            import xml.etree.ElementTree as ET
            root = ET.parse(path).getroot()
            content_hash = fingerprints(root).get(body.line_id)
            if content_hash is None:
                raise HTTPException(422, {"code": "line_not_found", "message": "line does not exist in document", "retryable": False})
            c.execute("INSERT INTO review_confirmations(project_id,line_id,revision,status,note,updated_at,content_hash) VALUES(?,?,?,?,?,?,?) ON CONFLICT(project_id,line_id) DO UPDATE SET revision=excluded.revision,status=excluded.status,note=excluded.note,updated_at=excluded.updated_at,content_hash=excluded.content_hash", (pid, body.line_id, revision, "confirmed" if body.confirmed else "open", body.note, stamp(), content_hash))
            c.execute("INSERT INTO review_versions VALUES(?,1) ON CONFLICT(project_id) DO UPDATE SET version=version+1", (pid,))
        return {"schema_version": "studio-review-item-v1", "project_id": pid, "line_id": body.line_id, "revision": revision, "version": version + 1, "status": "confirmed" if body.confirmed else "open", "note": body.note}

    return router
