from __future__ import annotations

from pathlib import Path
from typing import Callable, Literal

from fastapi import APIRouter, Depends, Header, HTTPException
from fastapi.responses import StreamingResponse
from urllib.parse import quote
from pydantic import BaseModel, ConfigDict, Field


class PublishRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    revision: str = Field(min_length=1)
    asset_id: str = Field(min_length=1)
    lrc_kind: Literal['lrc', 'elrc']
    lrc_text: str = Field(min_length=1, max_length=4_000_000)
    target_track_id: int | None = Field(default=None, gt=0)


def build_publish_router(service, *, auth: Callable, write: Callable,
                         project_row: Callable[[str], object], asset_path: Callable):
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
        if not row[2]:
            raise HTTPException(422, {'code':'audio_required','message':'上传音乐后才可打包音乐文件','retryable':False})
        if body.asset_id != row[2]:
            raise HTTPException(422, {"code": "publish_input_invalid", "message": "asset does not belong to project", "retryable": False})
        with service.db.connect() as c:
            found = c.execute("SELECT 1 FROM revisions WHERE id=? AND project_id=?", (body.revision, pid)).fetchone()
        if not found:
            raise HTTPException(422, {"code": "publish_input_invalid", "message": "revision does not belong to project", "retryable": False})

    @router.get("/projects/{pid}/packaging")
    def packaging(pid: str, _: object = Depends(auth)):
        from mutagen import File
        from mutagen.mp4 import MP4
        from mutagen.mp3 import MP3
        from mutagen.flac import FLAC
        from .publishing import stpp_tracks
        row = project(pid)
        if not row[2]:
            raise HTTPException(422, {'code':'audio_required','message':'上传音乐后才可打包音乐文件','retryable':False})
        with service.db.connect() as c:
            asset = c.execute('SELECT filename FROM assets WHERE id=?', (row[2],)).fetchone()
        path = Path(asset_path(pid))
        media = File(path)
        tracks, error = [], None
        if isinstance(media, MP4):
            try: tracks = stpp_tracks(path)
            except ValueError as exc: error = str(exc)
        from .media_format import describe_media
        return {'filename': asset[0], **describe_media(path, media, asset[0]), 'asset_id':row[2], 'supported':isinstance(media,(MP4,MP3,FLAC)) and not error,
                'tracks':tracks,'error':error}

    @router.post("/projects/{pid}/publish", status_code=202)
    def publish(pid: str, body: PublishRequest,
                subject: str = Depends(write), idem: str | None = Header(default=None, alias="Idempotency-Key")):
        validate(pid, body)
        import re
        if len(body.lrc_text.encode('utf-8')) > 4_000_000 or not all(re.match(r'^\[\d+:\d{2}\.\d{3}\]', line) for line in body.lrc_text.splitlines()) or '\x00' in body.lrc_text:
            raise HTTPException(422, {'code':'invalid_lrc','message':'兼容歌词格式或大小无效','retryable':False})
        if body.lrc_kind == 'lrc' and re.search(r'<\d+:\d{2}\.\d{3}>',body.lrc_text):
            raise HTTPException(422, {'code':'invalid_lrc','message':'普通 LRC 不能包含扩展时间标签','retryable':False})
        try:
            return service.create(pid, "publish", body.model_dump(), idem_key=idem, subject=subject)
        except ValueError as exc:
            raise HTTPException(409, {"code": "idempotency_mismatch", "message": str(exc), "retryable": False})

    @router.get("/projects/{pid}/exports")
    def exports(pid: str, _: object = Depends(auth)):
        prow = project(pid)
        service.reconcile_exports()
        with service.db.connect() as c:
            assets = {row['id']: row['filename'] for row in c.execute("SELECT id,filename FROM assets")}
            rows = c.execute("SELECT id FROM jobs WHERE project_id=? AND kind='publish' ORDER BY created_at DESC", (pid,)).fetchall()
        items = []
        for row in rows:
            job = service.get(row[0]); request = job["request"]; result = service.result(row[0]) or {}
            report = result.get("report")
            path = result.get("output_path")
            passed = isinstance(report, dict) and report.get("passed") is True
            available = not result.get("superseded") and job["status"] == "succeeded" and passed and bool(path) and Path(path).is_file()
            status = "superseded" if result.get("superseded") else "unavailable" if job["status"] == "succeeded" and (not path or not Path(path).is_file()) else job["status"]
            items.append({"filename": result.get('filename'), "asset_filename": assets.get(request.get('asset_id')),
                          "container": result.get('container'), "format_label": result.get('format_label'), "track_id": report.get('track_id') if isinstance(report,dict) else None,
                          "id": job["id"], "revision": request.get("revision"), "asset_id": request.get("asset_id"),
                          "lrc_kind": request.get("lrc_kind"), "target_track_id": request.get("target_track_id"), "status": status, "created_at": job["created_at"], "stale": request.get("revision") != prow[3],
                          "report": report, "download_url": f"/api/v1/projects/{pid}/exports/{job['id']}/download" if available else None,
                          "error": job["error"]})
        return {"schema_version": "studio-export-list-v1", "items": items}

    @router.get("/projects/{pid}/exports/{job_id}/download")
    def download(pid: str, job_id: str, _: object = Depends(auth)):
        project(pid)
        job = service.get(job_id)
        if not job or job["project_id"] != pid or job["kind"] != "publish":
            raise HTTPException(404, {"code": "export_not_found", "message": "export not found", "retryable": False})
        with service._lock, service.db.transaction():
            result = service.result(job_id) or {}; report = result.get("report") or {}
            if result.get('superseded'):
                raise HTTPException(410, {"code":"export_replaced","message":"此产物已被较新的成功产物替换","retryable":False})
            if job['status'] != 'succeeded' or report.get('passed') is not True:
                raise HTTPException(409, {"code":"export_unavailable","message":"export is not available","retryable":False})
            path = Path(result.get('output_path', ''))
            try:
                handle = path.open('rb')
            except (FileNotFoundError, IsADirectoryError):
                raise HTTPException(410, {"code":"export_unavailable","message":"export file is unavailable","retryable":False})
        # Open before releasing the switching lock. POSIX keeps the inode alive;
        # Windows defers deletion until this handle closes. Retry in either case.
        def chunks():
            try:
                while block := handle.read(256 * 1024):
                    yield block
            finally:
                handle.close()
                service.reconcile_exports()
        filename = result.get('filename') or path.name
        return StreamingResponse(chunks(), media_type='application/octet-stream', headers={
            'Content-Disposition': "attachment; filename*=UTF-8''" + quote(filename),
        })

    return router
