from .project_resources import stream_file
from .project_document import read_lyrics, initial_project
import hashlib, json, os, secrets, tempfile, uuid, shutil, time
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
from pydantic import BaseModel, Field, ConfigDict

from .auth import Settings
from .db import Database
from .search_conditions import SearchConditions, initial_conditions, read_conditions
from .documents import DocumentService, build_router
from .job_routes import create_job_router
from .jobs import JobService
from .publish import PublishRunner, MediaPublisher
from .publish_routes import build_publish_router
from .reading import SudachiReadingProposer, build_analysis_router
from .revisions import INITIAL_TTML, RevisionStore
from .studio.media import Asset, MediaError, MediaProbe, MediaService
from .upload import UploadLimitMiddleware

MAX_UPLOAD = 500 * 1024 * 1024


def stamp():
    return datetime.now(timezone.utc).isoformat()

def create_app(
    data_dir: str | Path | None = None, settings: Settings | None = None,
    reading_proposer=None, publisher=None, separator_factory=None, runtime_settings=None, runtime_identity=None, runtime_manifest=None,
) -> FastAPI:
    cfg = settings or Settings.from_env()
    if not cfg.origin or (cfg.mode != "local" and not cfg.trusted_gateway and not cfg.password):
        raise RuntimeError(
            "set STUDIO_ORIGIN and STUDIO_PASSWORD, or enable STUDIO_TRUSTED_GATEWAY"
        )
    root = Path(
        data_dir or os.getenv("STUDIO_DATA_DIR", Path(__file__).parent / "data-projects-v5")
    )
    root = root.resolve()
    db = Database(root / "studio.sqlite3")
    from .storage_paths import validate_database_paths
    validate_database_paths(db)
    from .runtime_settings import RuntimeSettings, settings_router
    preferences = runtime_settings or RuntimeSettings(root / "settings.json")
    from .project_deletion import recover_deletions
    recover_deletions(db, root)
    uploads = root / 'uploads'
    shutil.rmtree(uploads, ignore_errors=True)
    uploads.mkdir(parents=True)
    with db.connect() as c:
        known = {r[0] for r in c.execute('SELECT id FROM projects')}
    for directory in (root / 'projects').glob('*'):
        if directory.name not in known: shutil.rmtree(directory)
        else:
            with db.connect() as c:
                has_music = c.execute('SELECT source_asset_id FROM projects WHERE id=?', (directory.name,)).fetchone()[0]
            if not has_music:
                for name in ('source','cache'): shutil.rmtree(directory / name, ignore_errors=True)
    media_services = {}
    def media_for(pid):
        if pid not in media_services: media_services[pid] = MediaService(root / 'projects' / pid)
        return media_services[pid]
    revisions = RevisionStore(db, root / "projects")
    revisions.recover()
    from .vocals import VocalRunner
    from .vocal_routes import build_vocal_router, vocal_asset
    vocal_runner = VocalRunner(db, root / 'projects', separator_factory)
    configured_reading_proposer = reading_proposer or SudachiReadingProposer()
    if publisher is None:
        publisher = MediaPublisher()
    api = APIRouter(prefix="/api/v1")

    def fail(code, message, status=400, retryable=False, **extra):
        detail = {"code": code, "message": message, "retryable": retryable, **extra}
        raise HTTPException(status, detail)

    def auth(request: Request):
        token = request.cookies.get("studio_session")
        if cfg.mode == "local": return "local"
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
            fail("origin_forbidden", "访问地址与服务允许的来源不一致，请检查浏览器地址及 --origin／STUDIO_ORIGIN 配置", 403)
        csrf = request.cookies.get("studio_csrf")
        if cfg.mode != "local" and not cfg.trusted_gateway and (
            not csrf or csrf != request.headers.get("x-csrf-token")
        ):
            fail("csrf_failed", "csrf token required", 403)
        return subject

    class Login(BaseModel):
        password: str | None = None

    class ProjectCreate(BaseModel):
        model_config = ConfigDict(extra='forbid')
        name: str = Field(min_length=1, max_length=200)
        upload_id: str | None = None
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
            "library_id": preferences.read()["library_id"],
            "mode": "local" if cfg.mode == "local" else "gateway" if cfg.trusted_gateway else "password",
            "user": {"id": "local", "name": "Local user"} if subject else None,
        }

    @api.post("/session")
    def login(body: Login, request: Request):
        if (
            not request.headers.get("origin")
            or request.headers.get("origin") != cfg.origin
        ):
            fail("origin_forbidden", "访问地址与服务允许的来源不一致，请检查浏览器地址及 --origin／STUDIO_ORIGIN 配置", 403)
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

    @api.get("/runtime")
    def runtime(_=Depends(auth)):
        return runtime_identity or {"library_id": preferences.read()["library_id"]}

    @api.get("/capabilities")
    def capabilities():
        return {
            "schema_version": "studio-capabilities-v1",
            "items": [
                {"id": "assets", "enabled": True, "reason": None},
                {"id": "document.edit", "enabled": True, "reason": None},
                {"id": "job.run", "enabled": True, "reason": None},
                {"id": "job.alignment", "enabled": alignment_unavailable() is None, "reason": alignment_unavailable()},
                {"id": "publish.stpp", "enabled": publish_runner.available(),
                 "reason": None if publish_runner.available() else "未配置 STPP 发布器"},
            ],
        }

    def staged_upload(token):
        if not token or len(token) != 32 or any(ch not in '0123456789abcdef' for ch in token):
            fail('upload_not_found', '上传已失效，请重新上传', 404)
        directory = uploads / token
        try: metadata = json.loads((directory / 'asset.json').read_text())
        except FileNotFoundError: fail('upload_not_found', '上传已失效，请重新上传', 404)
        return directory, metadata

    def adopt_upload(c, token, pid):
        directory, record = staged_upload(token)
        destination = root / 'projects' / pid
        destination.mkdir(parents=True, exist_ok=True)
        for name in ('source', 'cache'):
            (directory / name).rename(destination / name)
        c.execute('INSERT INTO assets VALUES(?,?,?,?,?,?,?,?,?,?,?,?)', record)
        return c.execute('SELECT * FROM assets WHERE id=?', (token,)).fetchone()

    @api.post('/uploads')
    async def upload(request: Request, file: Annotated[UploadFile, File()], _: object = Depends(write)):
        # Each token owns independent files; no content-addressed shared asset library.
        with db.transaction():
            for metadata in uploads.glob('*/asset.json'):
                if metadata.stat().st_mtime < time.time() - 3600:
                    shutil.rmtree(metadata.parent)
        token = uuid.uuid4().hex
        directory = uploads / token
        directory.mkdir()
        temporary = directory / 'upload'
        successful = False
        try:
            size = 0
            digest = hashlib.sha256()
            with temporary.open('wb') as out:
                while chunk := await file.read(1024 * 1024):
                    size += len(chunk)
                    if size > MAX_UPLOAD: fail('upload_too_large', 'upload exceeds limit', 413)
                    out.write(chunk)
                    digest.update(chunk)
            media = MediaService(directory)
            asset = await run_in_threadpool(media.import_asset, temporary, file.filename, verified_sha256=digest.hexdigest())
            proxy = await run_in_threadpool(media.playback_proxy, asset)
            if await request.is_disconnected(): fail('upload_cancelled', '上传已取消', 409)
            record = [token, asset.content_hash, asset.size, asset.probe.mime_type, asset.original_name, 1,
                      asset.probe.duration_ms, asset.probe.start_ms, asset.probe.sample_rate, asset.probe.channels,
                      json.dumps({'codec': asset.probe.codec, 'container': asset.probe.container,
                                  'proxy_offset_ms': proxy.offset_ms, 'proxy_duration_ms': proxy.duration_ms}), stamp()]
            (directory / 'asset.json').write_text(json.dumps(record))
            successful = True
            return asset_dto(record)
        except MediaError as exc: fail('media_invalid', str(exc), 415)
        finally:
            temporary.unlink(missing_ok=True)
            await file.close()
            if not successful: shutil.rmtree(directory, ignore_errors=True)

    @api.delete('/uploads/{token}')
    def cancel_upload(token: str, _: object = Depends(write)):
        with db.transaction():
            directory, _ = staged_upload(token)
            shutil.rmtree(directory)
        return {'cancelled': token}

    class MusicUpload(BaseModel):
        upload_id: str

    @api.post('/projects/{pid}/music')
    def attach_music(pid: str, body: MusicUpload, _: object = Depends(write)):
        try:
            with db.transaction() as c:
                row = c.execute('SELECT source_asset_id FROM projects WHERE id=?', (pid,)).fetchone()
                if not row: fail('project_not_found', '项目已删除', 404)
                if row[0] == body.upload_id:
                    return asset_dto(c.execute('SELECT * FROM assets WHERE id=?', (row[0],)).fetchone())
                if row[0]: fail('project_changed', '项目音乐已改变，请刷新；未采用本次上传', 409)
                directory, _ = staged_upload(body.upload_id)
                try:
                    asset = adopt_upload(c, body.upload_id, pid)
                    c.execute('UPDATE projects SET source_asset_id=?,updated_at=? WHERE id=?', (asset[0], stamp(), pid))
                except Exception:
                    for name in ('source','cache'):
                        shutil.rmtree(root / 'projects' / pid / name, ignore_errors=True)
                    raise
            return asset_dto(asset)
        except Exception:
            with db.transaction() as c:
                current = c.execute('SELECT source_asset_id FROM projects WHERE id=?', (pid,)).fetchone()
                if current and not current[0]:
                    for name in ('source','cache'): shutil.rmtree(root / 'projects' / pid / name, ignore_errors=True)
            raise
        finally:
            # Committed and rejected uploads both cease to be pending assets.
            if len(body.upload_id) == 32 and all(ch in '0123456789abcdef' for ch in body.upload_id):
                shutil.rmtree(uploads / body.upload_id, ignore_errors=True)

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
        pid = None
        try:
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
                pid, t = uuid.uuid4().hex, stamp()
                rev = uuid.uuid4().hex
                asset = adopt_upload(c, body.upload_id, pid) if body.upload_id else None
                asset_id = asset[0] if asset else None
                path = root / 'projects' / pid / 'revisions' / f'{rev}.json'
                revisions._write_atomic(path, json.dumps(initial_project(INITIAL_TTML, None), ensure_ascii=False).encode())
                c.execute('INSERT INTO projects VALUES(?,?,?,?,?,?)', (pid, name, asset_id, rev, t, t))
                conditions = initial_conditions(root / 'projects' / pid / 'source' / 'original', body.source_filename or asset[4]) if asset else {'title':'','artist':'','album':''}
                c.execute('INSERT INTO search_conditions VALUES(?,?,?,?)', (pid, conditions['title'], conditions['artist'], conditions['album']))
                c.execute(
                    "INSERT INTO revisions VALUES(?,?,?,?,?)",
                    (rev, pid, None, db.paths.store(path), t),
                )
                result = {
                    "schema_version": "studio-project-v1",
                    "id": pid,
                    "name": name,
                    "updated_at": t,
                    "asset": asset_dto(asset) if asset else None,
                }
                c.execute(
                    "INSERT INTO idempotency VALUES(?,?,?,?,?)",
                    (key, subject, digest, json.dumps(result), t),
                )
        except Exception:
            if pid:
                # Move staged source back so an idempotent create can retry after a file/DB failure.
                if body.upload_id:
                    temporary = uploads / body.upload_id
                    for name in ('source','cache'):
                        source = root / 'projects' / pid / name
                        if source.exists(): source.rename(temporary / name)
                shutil.rmtree(root / 'projects' / pid, ignore_errors=True)
            raise
        if body.upload_id: shutil.rmtree(uploads / body.upload_id, ignore_errors=True)
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

    from .project_storage import build_storage_router
    api.include_router(build_storage_router(db, root, auth=auth, project_exists=project))
    from .project_archive import build_archive_router
    api.include_router(build_archive_router(db, root, revisions, auth=auth, write=write, project_exists=project))

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
        result = delete_project(db, root, pid)
        preferences.delete_project(pid)
        return result

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
        return Response(read_lyrics(db.paths.resolve(x[0])), media_type="application/ttml+xml", headers={"ETag": f'"{rev}"'})

    def asset_for(pid):
        r = project(pid)
        with db.connect() as c:
            return r, c.execute("SELECT * FROM assets WHERE id=?", (r[2],)).fetchone()

    def asset_model(row, pid):
        return Asset(
            row[0],
            row[1],
            root / 'projects' / pid / 'source' / 'original',
            row[4],
            row[2],
            MediaProbe(row[6], row[7] or 0, row[8], row[9], None, None, row[3]),
        )

    @api.get("/projects/{pid}/audio")
    def audio(pid: str, request: Request, vocal: str | None = None, _: object = Depends(auth)):
        with db.transaction():
            r, a = asset_for(pid)
            if not a:
                fail("audio_not_found", "audio not found", 404)
            asset = vocal_asset(vocal_runner, pid, vocal) if vocal else asset_model(a, pid)
            proxy = media_for(pid).playback_proxy(asset)
            return stream_file(proxy.path, proxy.mime_type, request.headers.get('range'), request.headers.get('if-range'))

    @api.get("/projects/{pid}/waveform")
    def waveform(
        pid: str,
        vocal: str | None = None,
        level: int = 0,
        start_ms: int = 0,
        end_ms: int = 1_000,
        _: object = Depends(auth),
    ):
        with db.transaction():
            _, a = asset_for(pid)
            if not a: fail('audio_not_found', '上传音乐后可用', 404)
            try:
                asset = vocal_asset(vocal_runner, pid, vocal) if vocal else asset_model(a, pid)
                peaks = media_for(pid).peaks(asset, level=level, start_ms=start_ms, end_ms=end_ms)
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
        with db.transaction():
            _, row = asset_for(pid)
            if not row:
                fail("audio_not_found", "audio not found", 404)
            try:
                data, rate, channels = media_for(pid).pcm_window(vocal_asset(vocal_runner, pid, vocal) if vocal else asset_model(row, pid), start_ms=start_ms, end_ms=end_ms)
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
        return root / 'projects' / pid / 'source' / 'original'

    from .alignment import AlignmentRunner, alignment_unavailable
    from .alignment_projection import project_alignment
    alignment_runner = AlignmentRunner(db, root / 'projects')

    @api.get('/projects/{pid}/alignment-preview')
    def alignment_preview(pid: str, revision: str, _=Depends(auth)):
        project(pid)
        try:
            snapshot, _ = alignment_runner.snapshot(pid, revision)
            return project_alignment(snapshot)['summary']
        except ValueError as exc: fail('alignment_input_invalid', str(exc), 409)

    def validate_job_request(pid, kind, params):
        if kind == 'alignment':
            try: alignment_runner.validate(pid, params)
            except ValueError as exc: fail('alignment_input_invalid', str(exc), 422)
            return
        if kind == 'vocal':
            row = project(pid)
            if not row[2] or params.get('asset_id') != row[2]: fail('job_input_invalid', '人声任务需要当前项目源音频', 422)
            if set(params) - {'asset_id', 'retry_analysis_id'}: fail('job_input_invalid', '人声参数由服务配置', 422)
            if params.get('retry_analysis_id'):
                if not isinstance(params['retry_analysis_id'], str): fail('job_input_invalid', '分析结果标识无效', 422)
                try: result, _ = vocal_runner.get(pid, params['retry_analysis_id'])
                except KeyError: fail('job_input_invalid', '可重用人声不存在', 422)
                if result['source_asset_id'] != row[2] or result['status'] not in {'separated', 'ready'}: fail('job_input_invalid', '只可分析当前源音频的人声结果', 422)
            params['model_name'] = os.getenv('STUDIO_VOCAL_MODEL', 'htdemucs')
            params['device'] = os.getenv('STUDIO_VOCAL_DEVICE', 'cpu')
            return
        if kind == "publish":
            fail("publish_endpoint_required", "publish jobs must use /projects/{pid}/publish", 422)
        fail('job_kind_removed', '不支持此任务类别', 422)

    publish_runner = PublishRunner(revisions, asset_path_for_project, root / "projects", publisher=publisher)
    job_service = JobService(db, asset_path=asset_path_for_project, publish_runner=publish_runner, vocal_runner=vocal_runner, alignment_runner=alignment_runner)
    api.include_router(create_job_router(job_service, job_project_exists, auth_dependency=auth, write_dependency=write, validate_request=validate_job_request))
    api.include_router(build_vocal_router(vocal_runner, auth=auth, project_exists=project))
    api.include_router(build_analysis_router(configured_reading_proposer, write=write))
    api.include_router(build_router(DocumentService(revisions), auth=auth, write=write, project_exists=project))
    from .lyric_sources import build_sources_router
    api.include_router(build_sources_router(write=write))
    api.include_router(build_publish_router(job_service, auth=auth, write=write, project_row=project, asset_path=asset_path_for_project))
    app = FastAPI(title="Lazulite Studio API", version="0.3.0")
    api.include_router(settings_router(preferences, auth=auth, write=write))
    app.include_router(api)
    if cfg.mode == "local":
        from .local_web import LocalBoundary
        app.add_middleware(LocalBoundary, origin=cfg.origin)
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
