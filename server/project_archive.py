"""Versioned .lazp interchange: one snapshot and at most one source recording."""
import hashlib
import json
import re
import shutil
import stat
import tempfile
import uuid
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask
from starlette.concurrency import run_in_threadpool
from pydantic import BaseModel, ConfigDict, Field, StrictInt
from .project_document import read_project, validate_project
from .studio.media import MediaService, MediaError
from .media_format import download_filename

MAX_AUDIO = 2 * 1024**3
MAX_DOCUMENT = 16 * 1024**2
MAX_MANIFEST = 16 * 1024
MAX_ARCHIVE = MAX_AUDIO + MAX_DOCUMENT + 1024**2

class SourceEntry(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    path: str = Field(pattern=r'^media/source\.[a-z0-9]{1,12}$')
    filename: str = Field(min_length=1, max_length=1000)
    size: StrictInt = Field(gt=0, le=MAX_AUDIO)
    sha256: str = Field(pattern=r'^[a-f0-9]{64}$')

class Manifest(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    format: Literal['lazulite-studio-project']
    version: Literal[1]
    name: str = Field(min_length=1, max_length=200)
    project: Literal['project.json']
    source: SourceEntry | None = None

def digest(path):
    with Path(path).open('rb') as file:
        return hashlib.file_digest(file, 'sha256').hexdigest()

def read_package(path, stage):
    with zipfile.ZipFile(path) as archive:
        entries = archive.infolist()
        names = [item.filename for item in entries]
        if len(entries) not in (2, 3) or len(set(names)) != len(names):
            raise ValueError('工程包条目数量或重复路径无效')
        for item in entries:
            if item.flag_bits & 1 or item.is_dir() or stat.S_ISLNK(item.external_attr >> 16):
                raise ValueError('工程包不能包含加密条目、目录或链接')
            limit = MAX_MANIFEST if item.filename == 'manifest.json' else MAX_DOCUMENT if item.filename == 'project.json' else MAX_AUDIO
            if item.file_size > limit or item.compress_size == 0 and item.file_size > 0:
                raise ValueError('工程包解包规模超出限制')
            if item.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED):
                raise ValueError('工程包压缩方式不支持')
        if 'manifest.json' not in names or 'project.json' not in names:
            raise ValueError('工程包缺少 manifest.json 或 project.json')
        manifest = Manifest.model_validate_json(archive.read('manifest.json'))
        if not manifest.name.strip(): raise ValueError('项目名称不能为空')
        expected = {'manifest.json', 'project.json'} | ({manifest.source.path} if manifest.source else set())
        if set(names) != expected: raise ValueError('工程包路径非法、缺少声明资源或包含多余资源')
        snapshot = json.loads(archive.read('project.json'))
        # Service identifiers never cross the interchange boundary.
        snapshot['acoustics']['analysisId'] = None
        source_path = None
        if manifest.source:
            entry = archive.getinfo(manifest.source.path)
            if entry.file_size != manifest.source.size: raise ValueError('源音频大小不匹配')
            source_path = stage / 'source-upload'
            with archive.open(entry) as src, source_path.open('wb') as dst:
                shutil.copyfileobj(src, dst, 1024**2)
            if digest(source_path) != manifest.source.sha256: raise ValueError('源音频 SHA-256 不匹配')
        return manifest, snapshot, source_path

def validate_archive_references(snapshot):
    import xml.etree.ElementTree as ET
    studio, xml, tt, ttm, tts = ('{urn:lazulite:studio:draft}', '{http://www.w3.org/XML/1998/namespace}', '{http://www.w3.org/ns/ttml}', '{http://www.w3.org/ns/ttml#metadata}', '{http://www.w3.org/ns/ttml#styling}')
    root = ET.fromstring(snapshot['lyrics']['draftTtml'])
    identity = lambda node: node.get(studio+'id') or node.get(xml+'id')
    lines = {identity(node):node for node in root.iter() if node.tag == tt+'p' or node.get(ttm+'role') == 'x-bg'}
    karaoke = snapshot['karaoke']
    groups = {group['id'] for group in karaoke['groups']}
    if any(key not in lines or group and group not in groups for key, group in karaoke['lineGroups'].items()):
        raise ValueError('工程歌词分组引用无效')
    for cue in karaoke['cues']:
        anchor = cue['anchor']
        line = lines.get(anchor['lineId'])
        if line is None: raise ValueError('工程导唱所属行不存在')
        if anchor['kind'] == 'before': continue
        words = [child for child in line if child.tag == tt+'span' and all(role == 'expletive' for role in child.get(ttm+'role','').split())]
        nodes = words
        if anchor['kind'] == 'ruby':
            word = next((word for word in words if identity(word) == anchor['wordId']), None)
            if word is None: raise ValueError('工程 Ruby 导唱所属词不存在')
            nodes = [node for node in word.iter() if node.get(tts+'ruby') == 'text']
        ids = [identity(node) for node in nodes]
        if not any(left == anchor['leftId'] and right == anchor['rightId'] for left,right in zip(ids,ids[1:])):
            raise ValueError('工程导唱锚点引用或相邻关系无效')


def build_archive_router(db, root, revisions, *, auth, write, project_exists):
    router = APIRouter()

    @router.get('/projects/{pid}/archive')
    def export_project(pid: str, _=Depends(auth)):
        temp = tempfile.TemporaryDirectory(prefix='studio-export-')
        path = Path(temp.name) / 'project.lazp'
        try:
            # Pin the revision and source together, and protect their files from deletion.
            with db.transaction() as c:
                project = project_exists(pid)
                row = c.execute('SELECT project_path FROM revisions WHERE id=? AND project_id=?', (project['current_revision'], pid)).fetchone()
                snapshot = read_project(row[0])
                snapshot['acoustics']['analysisId'] = None
                manifest = {'format':'lazulite-studio-project', 'version':1, 'name':project['name'], 'project':'project.json'}
                asset = c.execute('SELECT * FROM assets WHERE id=?', (project['source_asset_id'],)).fetchone()
                with zipfile.ZipFile(path, 'w', compression=zipfile.ZIP_STORED) as archive:
                    if asset:
                        source = root / 'projects' / pid / 'source' / 'original'
                        suffix = Path(asset['filename'] or '').suffix.lower().lstrip('.')
                        suffix = suffix if re.fullmatch('[a-z0-9]{1,12}', suffix) else 'bin'
                        name = f'media/source.{suffix}'
                        manifest['source'] = {'path':name, 'filename':asset['filename'] or 'source.bin', 'size':source.stat().st_size, 'sha256':digest(source)}
                        archive.write(source, name)
                    archive.writestr('project.json', json.dumps(snapshot, ensure_ascii=False))
                    archive.writestr('manifest.json', json.dumps(manifest, ensure_ascii=False))
            return FileResponse(path, media_type='application/zip', filename=download_filename(project['name'], '.lazp'), background=BackgroundTask(temp.cleanup))
        except Exception:
            temp.cleanup()
            raise

    def install(path, stage):
        manifest, snapshot, source = read_package(path, stage)
        pid, rid, aid = uuid.uuid4().hex, uuid.uuid4().hex, None
        now = datetime.now(timezone.utc).isoformat()
        staged_project = stage / 'project'
        staged_project.mkdir()
        record = None
        if source:
            media = MediaService(staged_project)
            asset = media.import_asset(source, manifest.source.filename)
            proxy = media.playback_proxy(asset)
            aid = uuid.uuid4().hex
            record = (aid, asset.content_hash, asset.size, asset.probe.mime_type, asset.original_name, 1,
                      asset.probe.duration_ms, asset.probe.start_ms, asset.probe.sample_rate, asset.probe.channels,
                      json.dumps({'codec':asset.probe.codec, 'container':asset.probe.container, 'proxy_offset_ms':proxy.offset_ms, 'proxy_duration_ms':proxy.duration_ms}), now)
        destination = root / 'projects' / pid
        try:
            with db.transaction() as c:
                if record: c.execute('INSERT INTO assets VALUES(?,?,?,?,?,?,?,?,?,?,?,?)', record)
                c.execute('INSERT INTO projects VALUES(?,?,?,?,?,?)', (pid, manifest.name.strip(), aid, rid, now, now))
                snapshot = validate_project(snapshot, c, pid)
                validate_archive_references(snapshot)
                relative = Path('revisions') / f'{rid}.json'
                revisions._write_atomic(staged_project / relative, json.dumps(snapshot, ensure_ascii=False).encode())
                c.execute('INSERT INTO revisions VALUES(?,?,?,?,?)', (rid, pid, None, str(destination / relative), now))
                c.execute('INSERT INTO search_conditions VALUES(?,?,?,?)', (pid, '', '', ''))
                staged_project.rename(destination)
            return {'schema_version':'studio-project-v1', 'id':pid, 'name':manifest.name.strip(), 'updated_at':now}
        except Exception:
            shutil.rmtree(destination, ignore_errors=True)
            raise

    @router.post('/project-archives')
    async def import_project(file: UploadFile = File(...), _=Depends(write)):
        try:
            with tempfile.TemporaryDirectory(prefix='studio-import-', dir=root) as directory:
                stage = Path(directory)
                path = stage / 'upload.lazp'
                size = 0
                with path.open('wb') as out:
                    while chunk := await file.read(1024**2):
                        size += len(chunk)
                        if size > MAX_ARCHIVE: raise HTTPException(413, '工程包超过大小限制')
                        out.write(chunk)
                try:
                    return await run_in_threadpool(install, path, stage)
                except (ValueError, KeyError, TypeError, zipfile.BadZipFile, RuntimeError, MediaError) as exc:
                    raise HTTPException(422, f'无法导入工程：{exc}') from exc
        finally:
            await file.close()
    return router
