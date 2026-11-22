from __future__ import annotations

import re
import shutil
import tempfile
from pathlib import Path
from typing import Callable, Literal
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, Field, model_validator

from .publish import PublishInvalid, serialize_output_ttml
from .publishing import PublishingError


class PackagingDownloadRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    revision: str = Field(min_length=1)
    asset_id: str = Field(min_length=1)
    stpp_action: Literal['none', 'add', 'overwrite']
    target_track_id: int | None = Field(default=None, gt=0)
    lrc_kind: Literal['none', 'lrc', 'elrc']
    lrc_text: str | None = Field(default=None, min_length=1)

    @model_validator(mode='after')
    def validate_payload(self):
        if (self.lrc_kind == 'none') != (self.lrc_text is None):
            raise ValueError('不写入须使用 null；写入 LRC 须提供歌词')
        if self.stpp_action == 'overwrite' and self.target_track_id is None:
            raise ValueError('覆盖 STPP 轨道须指定目标轨道 ID')
        if self.stpp_action != 'overwrite' and self.target_track_id is not None:
            raise ValueError('仅覆盖模式可指定目标轨道 ID')
        if self.stpp_action == 'none' and self.lrc_kind == 'none':
            raise ValueError('至少需要选择一项写入内容')
        return self


def build_publish_router(db, revisions, *, publisher, auth: Callable, write: Callable,
                         project_row: Callable[[str], object], asset_path: Callable):
    router = APIRouter()

    def project(pid):
        row = project_row(pid)
        if not row:
            raise HTTPException(404, {"code": "project_not_found", "message": "project not found", "retryable": False})
        return row

    @router.get("/projects/{pid}/embedded-lyrics")
    def embedded_lyrics(pid: str, _: object = Depends(auth)):
        import struct
        from .embedded_lyrics import read_embedded
        from mutagen import MutagenError
        row = project(pid)
        if not row[2]:
            raise HTTPException(422, {'code': 'audio_required', 'message': '请先上传音乐文件', 'retryable': False})
        try:
            return {'asset_id': row[2], 'candidates': read_embedded(Path(asset_path(pid)))}
        except (ValueError, MutagenError, OSError, struct.error) as exc:
            raise HTTPException(422, {'code': 'embedded_invalid', 'message': f'内嵌歌词读取失败：{exc}', 'retryable': False}) from exc

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
        with db.connect() as c:
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

    @router.post("/projects/{pid}/packaging/download")
    def packaging_download(pid: str, body: PackagingDownloadRequest, _: str = Depends(write)):
        if publisher is None or not callable(getattr(publisher, "publish", None)) or shutil.which("ffprobe") is None:
            raise HTTPException(503, {"code": "capability_unavailable", "message": "STPP publisher is not configured", "retryable": False})
        if body.lrc_kind != 'none':
            if not all(re.match(r'^\[\d+:\d{2}\.\d{3}\]', line) for line in body.lrc_text.splitlines()) or '\x00' in body.lrc_text:
                raise HTTPException(422, {'code':'invalid_lrc','message':'兼容歌词格式无效','retryable':False})
            if body.lrc_kind == 'lrc' and re.search(r'<\d+:\d{2}\.\d{3}>', body.lrc_text):
                raise HTTPException(422, {'code':'invalid_lrc','message':'普通 LRC 不能包含扩展时间标签','retryable':False})
        with db.project_read(pid):
            with db.connect() as c:
                bound = c.execute(
                    'SELECT p.source_asset_id,p.name,a.filename FROM projects p LEFT JOIN assets a ON a.id=p.source_asset_id WHERE p.id=?',
                    (pid,),
                ).fetchone()
                if not bound:
                    raise HTTPException(404, {"code": "project_not_found", "message": "project not found", "retryable": False})
                if not bound[0]:
                    raise HTTPException(422, {'code':'audio_required','message':'上传音乐后才可打包音乐文件','retryable':False})
                if body.asset_id != bound[0] or bound[2] is None:
                    raise HTTPException(422, {"code": "publish_input_invalid", "message": "asset does not belong to project", "retryable": False})
                has_rev = c.execute('SELECT 1 FROM revisions WHERE id=? AND project_id=?', (body.revision, pid)).fetchone()
            if not has_rev:
                raise HTTPException(409, {"code": "revision_unavailable", "message": "项目保存版本不可用，请重新保存后再试", "retryable": False})

            from mutagen import File
            from mutagen.mp4 import MP4
            from .media_format import describe_media, download_filename

            path = Path(asset_path(pid))
            media = File(path)
            format_info = describe_media(path, media, bound[2])
            if format_info['extension'] is None:
                raise HTTPException(422, {'code': 'unsupported_format', 'message': '源文件格式不支持打包', 'retryable': False})
            if body.stpp_action != 'none' and not isinstance(media, MP4):
                raise HTTPException(422, {'code': 'unsupported_stpp', 'message': '此容器不支持 STPP 轨道', 'retryable': False})

            ttml = None
            if body.stpp_action != 'none':
                try:
                    _, snapshot = revisions.read(pid, body.revision)
                    ttml = serialize_output_ttml(snapshot)
                except (PublishInvalid, ValueError) as exc:
                    raise HTTPException(422, {'code': 'publish_failed', 'message': str(exc), 'retryable': False}) from exc

            tmp_dir = tempfile.TemporaryDirectory(prefix='lazulite-pack-')
            output = Path(tmp_dir.name) / f"packaged{format_info['extension']}"
            try:
                target_track = body.target_track_id if body.stpp_action == 'overwrite' else None
                publisher.publish(ttml, path, output, body.lrc_text, target_track)
                handle = output.open('rb')
            except (PublishInvalid, PublishingError, ValueError) as exc:
                tmp_dir.cleanup()
                raise HTTPException(422, {'code': 'publish_failed', 'message': str(exc), 'retryable': False}) from exc
            except Exception as exc:
                tmp_dir.cleanup()
                raise HTTPException(500, {'code': 'packaging_failed', 'message': '音频打包失败，请检查服务日志', 'retryable': True}) from exc

        filename = download_filename(bound[1], format_info["extension"])

        def chunks():
            try:
                while block := handle.read(256 * 1024):
                    yield block
            finally:
                try:
                    handle.close()
                finally:
                    tmp_dir.cleanup()

        return StreamingResponse(
            chunks(),
            media_type='application/octet-stream',
            headers={
                'Content-Disposition': "attachment; filename*=UTF-8''" + quote(filename),
                'Cache-Control': 'no-store',
            },
        )

    return router
