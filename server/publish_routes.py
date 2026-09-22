from __future__ import annotations

from pathlib import Path
from typing import Callable

from fastapi import APIRouter, Depends, Header, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict, Field


class PublishRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    revision: str = Field(min_length=1)
    asset_id: str = Field(min_length=1)


def build_publish_router(service, *, auth: Callable, write: Callable,
                         project_row: Callable[[str], object]):
    router = APIRouter()

    def project(pid):
        try:
            row = project_row(pid)
        except HTTPException:
            raise
        if not row:
            raise HTTPException(404, {"code": "project_not_found", "message": "project not found", "retryable": False})
        return row

    def validate(pid, body):
        row = project(pid)
        if body.asset_id != row[2]:
            raise HTTPException(422, {"code": "publish_input_invalid", "message": "asset does not belong to project", "retryable": False})
        with service.db.connect() as c:
            found = c.execute("SELECT 1 FROM revisions WHERE id=? AND project_id=?", (body.revision, pid)).fetchone()
        if not found:
            raise HTTPException(422, {"code": "publish_input_invalid", "message": "revision does not belong to project", "retryable": False})

    @router.post("/projects/{pid}/publish", status_code=202)
    def publish(pid: str, body: PublishRequest,
                subject: str = Depends(write), idem: str | None = Header(default=None, alias="Idempotency-Key")):
        validate(pid, body)
        try:
            return service.create(pid, "publish", body.model_dump(), idem_key=idem, subject=subject)
        except ValueError as exc:
            raise HTTPException(409, {"code": "idempotency_mismatch", "message": str(exc), "retryable": False})

    @router.get("/projects/{pid}/exports")
    def exports(pid: str, _: object = Depends(auth)):
        prow = project(pid)
        with service.db.connect() as c:
            rows = c.execute("SELECT id FROM jobs WHERE project_id=? AND kind='publish' ORDER BY created_at DESC", (pid,)).fetchall()
        items = []
        for row in rows:
            job = service.get(row[0]); request = job["request"]; result = service.result(row[0]) or {}
            report = result.get("report")
            path = result.get("output_path")
            passed = isinstance(report, dict) and report.get("passed") is True
            available = job["status"] == "succeeded" and passed and bool(path) and Path(path).is_file()
            status = "unavailable" if job["status"] == "succeeded" and (not path or not Path(path).is_file()) else job["status"]
            items.append({"id": job["id"], "revision": request.get("revision"), "asset_id": request.get("asset_id"),
                          "status": status, "created_at": job["created_at"], "stale": request.get("revision") != prow[3],
                          "report": report, "download_url": f"/api/v1/projects/{pid}/exports/{job['id']}/download" if available else None,
                          "error": job["error"]})
        return {"schema_version": "studio-export-list-v1", "items": items}

    @router.get("/projects/{pid}/exports/{job_id}/download")
    def download(pid: str, job_id: str, _: object = Depends(auth)):
        project(pid)
        job = service.get(job_id)
        if not job or job["project_id"] != pid or job["kind"] != "publish":
            raise HTTPException(404, {"code": "export_not_found", "message": "export not found", "retryable": False})
        result = service.result(job_id) or {}; report = result.get("report") or {}
        path = Path(result.get("output_path", ""))
        passed = report.get("passed") is True
        if job["status"] != "succeeded" or not passed:
            raise HTTPException(409, {"code": "export_unavailable", "message": "export is not available", "retryable": False})
        if not path.is_file():
            raise HTTPException(410, {"code": "export_unavailable", "message": "export file is unavailable", "retryable": False})
        return FileResponse(path, media_type="application/octet-stream", filename=path.name)

    return router
