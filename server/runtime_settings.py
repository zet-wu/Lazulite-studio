"""Library identity and field-level portable preferences, outside project history."""
import json
import re
import threading
import uuid
from pathlib import Path
from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, ConfigDict
from .atomic_file import write_atomic

PREFERENCE_KEYS = {
    'lazulite-editor-theme', 'lazulite-shortcuts', 'lazulite-sync-keys',
    'lazulite-editor-columns', 'lazulite-kana-highlight', 'studio.playback-rate',
    'studio:sync-mode', 'studio:sync-offset',
}
PROJECT_KEY = re.compile(r'^(?:lazulite-romanization-mode|studio:sync-offset|studio:download|studio:packaging|studio:workspace-mode):project:([a-zA-Z0-9_-]+)$')


def allowed_key(key):
    return key in PREFERENCE_KEYS or PROJECT_KEY.fullmatch(key) is not None or key in {'device.vocal', 'device.alignment', 'port'}


class SettingsConflict(Exception):
    pass


class RuntimeSettings:
    def __init__(self, path: Path):
        self.path = path
        self.lock = threading.RLock()
        if not path.exists():
            self._write({'version': 1, 'library_id': uuid.uuid4().hex, 'revision': 0, 'imported': False, 'values': {}})
        self.read()

    def _write(self, value):
        write_atomic(self.path, json.dumps(value, ensure_ascii=False, indent=2).encode())

    def read(self):
        with self.lock:
            value = json.loads(self.path.read_text(encoding='utf-8'))
            if value.get('version') != 1 or not re.fullmatch('[0-9a-f]{32}', value.get('library_id', '')):
                raise ValueError('偏好文件版本或资料库身份无效，请恢复 settings.json 备份')
            return value

    def patch(self, changes, revision, *, import_legacy=False):
        with self.lock:
            current = self.read()
            if revision != current['revision']:
                raise SettingsConflict()
            if not isinstance(changes, dict) or len(changes) > 1024:
                raise ValueError('偏好字段无效')
            for key, value in changes.items():
                if not allowed_key(key): raise ValueError('不支持的偏好字段')
                if value is not None and (not isinstance(value, str) or len(value) > 16384): raise ValueError('偏好值无效')
                if key.startswith('device.') and value not in {'auto', 'cpu'}: raise ValueError('设备只能选择自动或 CPU')
                if key == 'port' and (not value or not value.isdecimal() or not 1024 <= int(value) <= 65535): raise ValueError('端口范围为 1024–65535')
            if import_legacy:
                if current['imported']: return current
                changes = {k: v for k, v in changes.items() if k not in current['values'] and not k.startswith('device.') and k != 'port'}
                current['imported'] = True
            for key, value in changes.items():
                if value is None: current['values'].pop(key, None)
                else: current['values'][key] = value
            current['revision'] += 1
            self._write(current)
            return current

    def delete_project(self, pid):
        with self.lock:
            current = self.read()
            keys = {k: None for k in current['values'] if (m := PROJECT_KEY.fullmatch(k)) and m[1] == pid}
            if keys: self.patch(keys, current['revision'])


class PreferencePatch(BaseModel):
    model_config = ConfigDict(extra='forbid')
    changes: dict[str, str | None]
    import_legacy: bool = False


def settings_router(settings, *, auth, write):
    from fastapi.responses import JSONResponse
    router = APIRouter()
    def response(value):
        return JSONResponse(value, headers={'ETag': f'"{value["revision"]}"', 'Cache-Control': 'no-store'})

    @router.get('/settings')
    def get_settings(_=Depends(auth)):
        return response(settings.read())

    @router.patch('/settings')
    def patch_settings(body: PreferencePatch, if_match: str = Header(), _=Depends(write)):
        try:
            if not re.fullmatch(r'"\d+"', if_match): raise ValueError('需要偏好版本 ETag')
            return response(settings.patch(body.changes, int(if_match.strip('"')), import_legacy=body.import_legacy))
        except SettingsConflict:
            raise HTTPException(409, {'code': 'settings_conflict', 'message': '偏好已在另一页面修改，请刷新后重试', 'retryable': True})
        except ValueError as exc:
            raise HTTPException(422, str(exc))
    return router
