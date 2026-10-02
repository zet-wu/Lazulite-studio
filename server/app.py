from io import StringIO
from .project_document import read_lyrics, initial_project
import hashlib, json, os, secrets, tempfile, uuid
import xml.etree.ElementTree as ET
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Annotated

from fastapi import (
    APIRouter,
    Depends,
    FastAPI,
    File,
    Header,
    HTTPException,
    Request,
    UploadFile,
)
from starlette.exceptions import HTTPException as StarletteHTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field

from .auth import Settings
from .db import Database
from .search_conditions import SearchConditions, initial_conditions, read_conditions
from .documents import DocumentService, build_router
from .job_routes import create_job_router
from .jobs import JobService
from .publish import PublishRunner, MediaPublisher
from .publish_routes import build_publish_router
from .engine import configured_engine
from .forced import configured_forced_runner, prepare_forced_request
from .projection import project_ttml, project_ttml_for_forced
from .reading import ReadingJobRunner, ReadingDictionary, SudachiReadingProposer, build_dictionary_router
from .review import build_router as build_review_router
from .revisions import INITIAL_TTML, RevisionStore
from .studio.media import Asset, MediaError, MediaProbe, MediaService
from .upload import UploadLimitMiddleware

MAX_UPLOAD = 500 * 1024 * 1024


def stamp():
    return datetime.now(timezone.utc).isoformat()

def create_app(
    data_dir: str | Path | None = None, settings: Settings | None = None, engine=None,
    reading_proposer=None, forced_aligner=None, publisher=None, separator_factory=None,
) -> FastAPI:
    cfg = settings or Settings.from_env()
    if not cfg.origin or (not cfg.trusted_gateway and not cfg.password):
        raise RuntimeError(
            "set STUDIO_ORIGIN and STUDIO_PASSWORD, or enable STUDIO_TRUSTED_GATEWAY"
        )
    root = Path(
        data_dir or os.getenv("STUDIO_DATA_DIR", Path(__file__).parent / "data")
    )
    db, media = Database(root / "studio.sqlite3"), MediaService(root)
    revisions = RevisionStore(db, root / "revisions")
    revisions.recover()
    from .vocals import VocalRunner
    from .vocal_routes import build_vocal_router, vocal_asset
    vocal_runner = VocalRunner(db, root / 'vocals', separator_factory)
    configured_engine_instance = engine or configured_engine()
    if forced_aligner is not None:
        from .forced import ForcedAlignmentRunner
        configured_engine_instance.forced_runner = ForcedAlignmentRunner(forced_aligner)
    elif getattr(configured_engine_instance, "forced_runner", None) is None:
        configured_engine_instance.forced_runner = configured_forced_runner()
    configured_reading_proposer = reading_proposer or SudachiReadingProposer()
    if publisher is None:
        publisher = MediaPublisher()
    reading_runner = ReadingJobRunner(db, configured_reading_proposer)
    api = APIRouter(prefix="/api/v1")

    def fail(code, message, status=400, retryable=False, **extra):
        detail = {"code": code, "message": message, "retryable": retryable, **extra}
        raise HTTPException(status, detail)

    def auth(request: Request):
        token = request.cookies.get("studio_session")
        if cfg.trusted_gateway:
            return "gateway"
        if not token:
            fail("unauthorized", "session required", 401)
        with db.connect() as c:
            row = c.execute(
                "SELECT 1 FROM sessions WHERE token_hash=? AND revoked=0 AND expires_at>?",
                (hashlib.sha256(token.encode()).hexdigest(), stamp()),
            ).fetchone()
        if not row:
            fail("unauthorized", "session expired", 401)
        return "local"

    def write(request: Request, subject=Depends(auth)):
        if (
            not request.headers.get("origin")
            or request.headers.get("origin") != cfg.origin
        ):
            fail("origin_forbidden", "origin is not allowed", 403)
        csrf = request.cookies.get("studio_csrf")
        if not cfg.trusted_gateway and (
            not csrf or csrf != request.headers.get("x-csrf-token")
        ):
            fail("csrf_failed", "csrf token required", 403)
        return subject

    class Login(BaseModel):
        password: str | None = None

    class ProjectCreate(BaseModel):
        name: str = Field(min_length=1, max_length=200)
        source_asset_id: str
        source_filename: str | None = Field(default=None, max_length=1000)

    def asset_dto(row):
        metadata = json.loads(row[10] or "{}")
        return {
            "schema_version": "studio-asset-v1",
            "id": row[0],
            "filename": row[4] or "",
            "content_type": row[3],
            "size_bytes": row[2],
            "duration_ms": metadata.get("proxy_duration_ms"),
            "status": "ready" if row[5] else "processing",
            "asset_hash": row[1],
            "source_start_ms": row[7] or 0,
            "proxy_offset_ms": metadata.get("proxy_offset_ms", 0),
        }

    @api.get("/session")
    def get_session(request: Request):
        try:
            subject = auth(request)
        except HTTPException:
            subject = None
        return {
            "schema_version": "studio-session-v1",
            "authenticated": subject is not None,
            "user": {"id": "local", "name": "Local user"} if subject else None,
        }

    @api.post("/session")
    def login(body: Login, request: Request):
        if (
            not request.headers.get("origin")
            or request.headers.get("origin") != cfg.origin
        ):
            fail("origin_forbidden", "origin is not allowed", 403)
        if cfg.password and not secrets.compare_digest(
            body.password or "", cfg.password
        ):
            fail("invalid_credentials", "invalid password", 401)
        token, csrf = secrets.token_urlsafe(32), secrets.token_urlsafe(24)
        with db.transaction() as c:
            c.execute(
                "INSERT INTO sessions VALUES(?,?,0)",
                (
                    hashlib.sha256(token.encode()).hexdigest(),
                    (datetime.now(timezone.utc) + timedelta(hours=8)).isoformat(),
                ),
            )
        out = JSONResponse(
            {
                "schema_version": "studio-session-v1",
                "authenticated": True,
                "user": {"id": "local", "name": "Local user"},
            }
        )
        secure = cfg.origin.startswith("https://")
        out.set_cookie(
            "studio_session",
            token,
            httponly=True,
            samesite="lax",
            secure=secure,
            max_age=28800,
        )
        out.set_cookie(
            "studio_csrf", csrf, samesite="lax", secure=secure, max_age=28800
        )
        return out

    @api.delete("/session")
    def logout(request: Request, _: object = Depends(write)):
        token = request.cookies.get("studio_session")
        if token:
            with db.transaction() as c:
                c.execute(
                    "UPDATE sessions SET revoked=1 WHERE token_hash=?",
                    (hashlib.sha256(token.encode()).hexdigest(),),
                )
        out = JSONResponse({"authenticated": False})
        out.delete_cookie("studio_session")
        out.delete_cookie("studio_csrf")
        return out

    @api.get("/capabilities")
    def capabilities():
        reading_enabled = reading_runner.available()
        return {
            "schema_version": "studio-capabilities-v1",
            "items": [
                {"id": "assets", "enabled": True, "reason": None},
                {"id": "document.edit", "enabled": True, "reason": None},
                {"id": "job.run", "enabled": True, "reason": None},
                {"id": "job.search", "enabled": True, "reason": None},
                {"id": "job.fetch", "enabled": True, "reason": None},
                {"id": "job.transcribe", "enabled": bool(getattr(configured_engine_instance, "transcriber", None)),
                 "reason": None if getattr(configured_engine_instance, "transcriber", None) else "未配置转写模型后端"},
                {"id": "job.align", "enabled": bool(getattr(configured_engine_instance, "transcriber", None)),
                 "reason": None if getattr(configured_engine_instance, "transcriber", None) else "未配置转写模型后端"},
                {"id": "job.forced_align", "enabled": bool(getattr(getattr(configured_engine_instance, "forced_runner", None), "available", False)),
                 "experimental": True,
                 "reason": None if getattr(getattr(configured_engine_instance, "forced_runner", None), "available", False) else "未显式配置实验 forced aligner"},
                {"id": "job.reading", "enabled": reading_enabled,
                 "reason": None if reading_enabled else (reading_runner.reason() or "未配置日语读音后端")},
                {"id": "publish.stpp", "enabled": publish_runner.available(),
                 "reason": None if publish_runner.available() else "未配置 STPP 发布器"},
            ],
        }

    @api.post("/assets")
    async def upload(file: Annotated[UploadFile, File()], _: object = Depends(write)):
        fd, temp_name = tempfile.mkstemp(prefix="studio-upload-", dir=root)
        os.close(fd)
        temp = Path(temp_name)
        size = 0
        try:
            with temp.open("wb") as out:
                while chunk := await file.read(1024 * 1024):
                    size += len(chunk)
                    if size > MAX_UPLOAD:
                        fail("upload_too_large", "upload exceeds limit", 413)
                    out.write(chunk)
            asset = await run_in_threadpool(media.import_asset, temp, file.filename)
            proxy = await run_in_threadpool(media.playback_proxy, asset)
            with db.transaction() as c:
                existing = c.execute(
                    "SELECT id FROM assets WHERE sha256=?", (asset.content_hash,)
                ).fetchone()
                asset_id = existing[0] if existing else asset.content_hash
                metadata = json.dumps(
                    {
                        "codec": asset.probe.codec,
                        "container": asset.probe.container,
                        "proxy_offset_ms": proxy.offset_ms,
                        "proxy_duration_ms": proxy.duration_ms,
                    }
                )
                if not existing:
                    c.execute(
                        "INSERT INTO assets VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
                        (
                            asset_id,
                            asset.content_hash,
                            asset.size,
                            asset.probe.mime_type,
                            asset.original_name,
                            1,
                            asset.probe.duration_ms,
                            asset.probe.start_ms,
                            asset.probe.sample_rate,
                            asset.probe.channels,
                            metadata,
                            stamp(),
                        ),
                    )
            with db.connect() as c:
                stored = c.execute(
                    "SELECT * FROM assets WHERE id=?", (asset_id,)
                ).fetchone()
            return asset_dto(stored)
        except MediaError as exc:
            fail("media_invalid", str(exc), 415)
        finally:
            temp.unlink(missing_ok=True)
            await file.close()

    @api.post("/projects")
    def create_project(
        body: ProjectCreate,
        request: Request,
        subject: str = Depends(write),
        idem: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
    ):
        name = body.name.strip()
        if not name:
            fail("invalid_name", "name cannot be blank", 422)
        digest = hashlib.sha256(
            json.dumps(
                [subject, "project.create", body.model_dump()],
                sort_keys=True,
                separators=(",", ":"),
            ).encode()
        ).hexdigest()
        key = idem or uuid.uuid4().hex
        with db.transaction() as c:
            old = c.execute(
                "SELECT response,request_hash FROM idempotency WHERE key=?", (key,)
            ).fetchone()
            if old:
                if old[1] != digest:
                    fail(
                        "idempotency_mismatch", "key was used for another request", 409
                    )
                return json.loads(old[0])
            asset = c.execute(
                "SELECT * FROM assets WHERE id=?", (body.source_asset_id,)
            ).fetchone()
            if not asset:
                fail("asset_not_found", "source asset not found", 404)
            pid, t = uuid.uuid4().hex, stamp()
            rev = uuid.uuid4().hex
            path = root / "revisions" / f"{rev}.json"
            revisions._write_atomic(path, json.dumps(initial_project(INITIAL_TTML, body.source_asset_id), ensure_ascii=False).encode())
            c.execute(
                "INSERT INTO projects VALUES(?,?,?,?,?,?)",
                (pid, name, body.source_asset_id, rev, t, t),
            )
            conditions = initial_conditions(root / "assets" / asset[1][:2] / asset[1], body.source_filename or asset[4])
            c.execute("INSERT INTO search_conditions VALUES(?,?,?,?)", (pid, conditions['title'], conditions['artist'], conditions['album']))
            c.execute(
                "INSERT INTO revisions VALUES(?,?,?,?,?)",
                (rev, pid, None, str(path), t),
            )
            result = {
                "schema_version": "studio-project-v1",
                "id": pid,
                "name": name,
                "updated_at": t,
                "document_status": "draft",
                "asset": asset_dto(asset),
            }
            c.execute(
                "INSERT INTO idempotency VALUES(?,?,?,?,?)",
                (key, subject, digest, json.dumps(result), t),
            )
        try:
            revisions.materialize_current(pid)
        except OSError:
            import logging

            logging.getLogger(__name__).warning(
                "failed to materialize draft for %s", pid, exc_info=True
            )
        return result

    def project(pid):
        with db.connect() as c:
            row = c.execute("SELECT * FROM projects WHERE id=?", (pid,)).fetchone()
        if not row:
            fail("project_not_found", "project not found", 404)
        return row

    @api.get("/projects")
    def projects(_: object = Depends(auth), limit: int = 50, cursor: str | None = None):
        limit = max(1, min(limit, 100))
        with db.connect() as c:
            if cursor:
                mark = c.execute(
                    "SELECT updated_at,id FROM projects WHERE id=?", (cursor,)
                ).fetchone()
                rows = (
                    c.execute(
                        "SELECT * FROM projects WHERE (updated_at,id)<(?,?) ORDER BY updated_at DESC,id DESC LIMIT ?",
                        (mark[0], mark[1], limit + 1),
                    ).fetchall()
                    if mark
                    else []
                )
            else:
                rows = c.execute(
                    "SELECT * FROM projects ORDER BY updated_at DESC,id DESC LIMIT ?",
                    (limit + 1,),
                ).fetchall()
        items = [
            {
                "schema_version": "studio-project-v1",
                "id": r[0],
                "name": r[1],
                "updated_at": r[5],
                "document_status": "draft",
            }
            for r in rows[:limit]
        ]
        return {
            "schema_version": "studio-project-list-v1",
            "items": items,
            "next_cursor": rows[limit - 1][0] if len(rows) > limit else None,
        }

    @api.get("/projects/{pid}")
    def get_project(pid: str, _: object = Depends(auth)):
        r = project(pid)
        with db.connect() as c:
            a = c.execute("SELECT * FROM assets WHERE id=?", (r[2],)).fetchone()
        return {
            "schema_version": "studio-project-v1",
            "id": r[0],
            "name": r[1],
            "updated_at": r[5],
            "document_status": "draft",
            "asset": asset_dto(a) if a else None,
        }

    @api.get("/projects/{pid}/search-conditions")
    def get_search_conditions(pid: str, _: object = Depends(auth)):
        project(pid)
        with db.connect() as c:
            return read_conditions(c, pid)

    @api.put("/projects/{pid}/search-conditions")
    def put_search_conditions(pid: str, body: SearchConditions, _: object = Depends(write)):
        with db.transaction() as c:
            if not c.execute("SELECT 1 FROM projects WHERE id=?", (pid,)).fetchone():
                fail("project_not_found", "项目不存在", 404)
            c.execute("INSERT INTO search_conditions VALUES(?,?,?,?) ON CONFLICT(project_id) DO UPDATE SET title=excluded.title,artist=excluded.artist,album=excluded.album", (pid, body.title, body.artist, body.album))
        return body.model_dump()

    @api.delete("/projects/{pid}")
    def remove_project(pid: str, _: object = Depends(write)):
        from .project_deletion import delete_project
        return delete_project(db, root, pid)

    @api.get("/projects/{pid}/lyrics")
    def lyrics(pid: str, revision: str | None = None, _: object = Depends(auth)):
        r = project(pid)
        rev = revision or r[3]
        with db.connect() as c:
            x = c.execute(
                "SELECT project_path FROM revisions WHERE id=? AND project_id=?",
                (rev, pid),
            ).fetchone()
        if not x:
            fail("revision_not_found", "revision not found", 404)
        from .project_document import read_lyrics, initial_project
        return Response(read_lyrics(x[0]), media_type="application/ttml+xml", headers={"ETag": f'"{rev}"'})

    def asset_for(pid):
        r = project(pid)
        with db.connect() as c:
            return r, c.execute("SELECT * FROM assets WHERE id=?", (r[2],)).fetchone()

    def asset_model(row):
        return Asset(
            row[0],
            row[1],
            root / "assets" / row[1][:2] / row[1],
            row[4],
            row[2],
            MediaProbe(row[6], row[7] or 0, row[8], row[9], None, None, row[3]),
        )

    @api.get("/projects/{pid}/audio")
    def audio(pid: str, vocal: str | None = None, _: object = Depends(auth)):
        r, a = asset_for(pid)
        if not a:
            fail("audio_not_found", "audio not found", 404)
        asset = vocal_asset(vocal_runner, pid, vocal) if vocal else asset_model(a)
        proxy = media.playback_proxy(asset)
        return FileResponse(proxy.path, media_type=proxy.mime_type)

    @api.get("/projects/{pid}/waveform")
    def waveform(
        pid: str,
        vocal: str | None = None,
        level: int = 0,
        start_ms: int = 0,
        end_ms: int = 1_000,
        _: object = Depends(auth),
    ):
        _, a = asset_for(pid)
        try:
            asset = vocal_asset(vocal_runner, pid, vocal) if vocal else asset_model(a)
            peaks = media.peaks(asset, level=level, start_ms=start_ms, end_ms=end_ms)
        except MediaError as exc:
            fail("waveform_invalid", str(exc), 422)
        return {
            "schema_version": "studio-waveform-v1",
            "asset_id": a[0],
            "asset_hash": peaks.asset_hash,
            "version": peaks.version,
            "level": level,
            "start_ms": peaks.start_ms,
            "end_ms": peaks.end_ms,
            "bucket_ms": peaks.bucket_ms,
            "minimum": peaks.minimum,
            "maximum": peaks.maximum,
        }

    @api.get("/projects/{pid}/pcm")
    def pcm_window(pid: str, start_ms: int, end_ms: int, vocal: str | None = None, _: object = Depends(auth)):
        """Read a PCM proxy window of at most 4,020,000 milliseconds (FFT context included)."""
        _, row = asset_for(pid)
        if not row:
            fail("audio_not_found", "audio not found", 404)
        try:
            data, rate, channels = media.pcm_window(vocal_asset(vocal_runner, pid, vocal) if vocal else asset_model(row), start_ms=start_ms, end_ms=end_ms)
        except MediaError as exc:
            fail("pcm_invalid", str(exc), 422)
        return Response(data, media_type="application/octet-stream", headers={"X-Sample-Rate": str(rate), "X-Channels": str(channels), "Cache-Control": "private, max-age=60"})

    def job_project_exists(pid):
        try:
            project(pid)
            return True
        except HTTPException:
            return False

    def asset_path_for_project(pid):
        _, row = asset_for(pid)
        if not row:
            raise ValueError("project source asset not found")
        return root / "assets" / row[1][:2] / row[1]

    def validate_job_request(pid, kind, params):
        if kind == 'vocal':
            row = project(pid)
            if not row[2] or params.get('asset_id') != row[2]: fail('job_input_invalid', '人声任务需要当前项目源音频', 422)
            if set(params) - {'asset_id', 'retry_analysis_id'}: fail('job_input_invalid', '人声参数由服务配置', 422)
            if params.get('retry_analysis_id'):
                if not isinstance(params['retry_analysis_id'], str): fail('job_input_invalid', '分析结果标识无效', 422)
                try: result, _ = vocal_runner.get(pid, params['retry_analysis_id'])
                except KeyError: fail('job_input_invalid', '可重用人声不存在', 422)
                if result['source_asset_id'] != row[2] or result['status'] != 'separated': fail('job_input_invalid', '只可重试当前源音频的未完成分析', 422)
            params['model_name'] = os.getenv('STUDIO_VOCAL_MODEL', 'htdemucs')
            params['device'] = os.getenv('STUDIO_VOCAL_DEVICE', 'cpu')
            return
        if kind == "publish":
            fail("publish_endpoint_required", "publish jobs must use /projects/{pid}/publish", 422)
        # Automated proposals must identify the immutable inputs they bind to.
        revision = params.get("revision")
        asset_id = params.get("asset_id")
        row = project(pid)
        if not revision or not asset_id or (revision != row[3] and not _revision_belongs(pid, revision)):
            fail("job_input_invalid", "job must reference a revision and asset belonging to project", 422)
        if asset_id != row[2]:
            fail("job_input_invalid", "asset does not belong to project", 422)
        with db.connect() as c:
            revision_row = c.execute("SELECT project_path FROM revisions WHERE id=? AND project_id=?", (revision, pid)).fetchone()
        if revision_row:
            try:
                selected_forced = params.get("line_id") if kind in {"forced", "forced_align", "forced-alignment"} else None
                projected = (project_ttml_for_forced(StringIO(read_lyrics(revision_row[0])), selected_forced) if kind in {"forced", "forced_align", "forced-alignment"}
                             else project_ttml(StringIO(read_lyrics(revision_row[0]))))
                selected = params.get("line_ids")
                if selected is not None and any(item not in {line["id"] for line in projected} for item in selected):
                    fail("job_input_invalid", "selected line does not belong to revision", 422)
                if kind in {"line_align", "align"}:
                    params["lines"] = [line for line in projected if selected is None or line["id"] in selected]
                if kind in {"forced", "forced_align", "forced-alignment"}:
                    line_id = params.get("line_id")
                    if not line_id or line_id not in {line["id"] for line in projected}:
                        fail("job_input_invalid", "forced alignment requires one line_id", 422)
                    line = next(line for line in projected if line["id"] == line_id)
                    with db.connect() as review_db:
                        confirmation = review_db.execute(
                            "SELECT status,revision FROM review_confirmations WHERE project_id=? AND line_id=?",
                            (pid, line_id),
                        ).fetchone()
                    if not confirmation or confirmation[0] != "confirmed" or confirmation[1] != revision:
                        fail("job_input_invalid", "forced alignment requires a confirmed lyric line at this revision", 422)
                    try:
                        prepare_forced_request(line, params, confirmed=bool(confirmation and confirmation[0] == "confirmed"), confirmed_revision=confirmation[1] if confirmation else None, revision=revision)
                    except ValueError as exc:
                        fail("job_input_invalid", str(exc), 422)
            except (ET.ParseError, OSError, ValueError) as exc:
                fail("job_input_invalid", "revision cannot be projected", 422)

    def _revision_belongs(pid, revision):
        with db.connect() as c:
            return c.execute("SELECT 1 FROM revisions WHERE id=? AND project_id=?", (revision, pid)).fetchone() is not None

    publish_runner = PublishRunner(revisions, asset_path_for_project, root / "exports", publisher=publisher)
    job_service = JobService(db, engine=configured_engine_instance, asset_path=asset_path_for_project, reading_runner=reading_runner, publish_runner=publish_runner, vocal_runner=vocal_runner)
    api.include_router(create_job_router(job_service, job_project_exists, auth_dependency=auth, write_dependency=write, validate_request=validate_job_request))
    api.include_router(build_vocal_router(vocal_runner, auth=auth, project_exists=project))
    api.include_router(build_dictionary_router(ReadingDictionary(db), auth=auth, write=write, project_exists=project))
    api.include_router(build_router(DocumentService(revisions), auth=auth, write=write, project_exists=project))
    from .lyric_sources import build_sources_router
    api.include_router(build_sources_router(write=write))
    api.include_router(build_publish_router(job_service, auth=auth, write=write, project_row=project, asset_path=asset_path_for_project))
    api.include_router(build_review_router(db, auth=auth, write=write, project_exists=project, stamp=stamp))
    app = FastAPI(title="Lazulite Studio API", version="0.3.0")
    app.include_router(api)
    app.add_middleware(UploadLimitMiddleware, limit=MAX_UPLOAD + 1024 * 1024)
    @app.on_event("shutdown")
    async def shutdown_jobs():
        job_service.close()

    @app.exception_handler(HTTPException)
    async def http_error(request: Request, exc: HTTPException):
        d = (
            exc.detail
            if isinstance(exc.detail, dict)
            else {"code": "http_error", "message": str(exc.detail), "retryable": False}
        )
        return JSONResponse(
            {**d, "request_id": request.headers.get("x-request-id", uuid.uuid4().hex)},
            status_code=exc.status_code,
        )

    @app.exception_handler(StarletteHTTPException)
    async def starlette_error(request: Request, exc: StarletteHTTPException):
        if isinstance(exc.detail, dict):
            detail = exc.detail
        elif exc.status_code == 404:
            detail = {
                "code": "not_found",
                "message": "resource not found",
                "retryable": False,
            }
        elif exc.status_code == 405:
            detail = {
                "code": "method_not_allowed",
                "message": "method not allowed",
                "retryable": False,
            }
        else:
            detail = {
                "code": "http_error",
                "message": str(exc.detail),
                "retryable": False,
            }
        return JSONResponse(
            {
                **detail,
                "request_id": request.headers.get("x-request-id", uuid.uuid4().hex),
            },
            status_code=exc.status_code,
        )

    @app.exception_handler(RequestValidationError)
    async def validation(request: Request, exc: RequestValidationError):
        return JSONResponse(
            {
                "code": "validation_error",
                "message": "invalid request",
                "retryable": False,
                "request_id": request.headers.get("x-request-id", uuid.uuid4().hex),
            },
            status_code=422,
        )

    return app
