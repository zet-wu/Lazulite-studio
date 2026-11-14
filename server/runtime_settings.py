"""Library identity and field-level portable preferences, outside project history."""
import json
import re
import threading
import uuid
from pathlib import Path
from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, ConfigDict
from .atomic_file import write_atomic

UI_LANGUAGES = {language['id'] for language in json.loads(Path(__file__).with_name('ui_languages.json').read_text(encoding='utf-8')) if language['complete']}

PREFERENCE_KEYS = {
    'studio:convert-particles', 'studio:kana-highlight', 'studio:alignment-defaults', 'studio:alignment-model',
    'studio:preview-translation', 'studio:preview-romanization', 'studio:preview-hide', 'studio:preview-fade',
    'lazulite-editor-theme', 'lazulite-shortcuts',
    'lazulite-editor-columns', 'studio.playback-rate',
    'studio:sync-mode', 'studio:sync-offset',
    'studio:reading-dictionary', 'studio:ui-language',
}
PROJECT_KEY = re.compile(r'^(?:lazulite-romanization-mode|studio:sync-offset|studio:download|studio:packaging|studio:workspace-mode):project:([a-zA-Z0-9_-]+)$')


def allowed_key(key):
    return key in PREFERENCE_KEYS or PROJECT_KEY.fullmatch(key) is not None or key in {'device.vocal', 'device.alignment', 'port', 'alignment.models_dir'}


class SettingsConflict(Exception):
    pass


class RuntimeSettings:
    def __init__(self, path: Path):
        self.path = path
        self.lock = threading.RLock()
        if not path.exists():
            self._write({'version': 1, 'library_id': uuid.uuid4().hex, 'revision': 0, 'values': {}})
        self.read()

    def _write(self, value):
        write_atomic(self.path, json.dumps(value, ensure_ascii=False, indent=2).encode())

    def read(self):
        with self.lock:
            value = json.loads(self.path.read_text(encoding='utf-8'))
            if value.get('version') != 1 or not re.fullmatch('[0-9a-f]{32}', value.get('library_id', '')):
                raise ValueError('偏好文件版本或资料库身份无效，请恢复 settings.json 备份')
            return {key: value[key] for key in ('version', 'library_id', 'revision', 'values')}

    def patch(self, changes, revision):
        with self.lock:
            current = self.read()
            if revision != current['revision']:
                raise SettingsConflict()
            if not isinstance(changes, dict) or len(changes) > 1024:
                raise ValueError('偏好字段无效')
            for key, value in changes.items():
                if not allowed_key(key): raise ValueError('不支持的偏好字段')
                if value is not None and (not isinstance(value, str) or len(value) > 16384): raise ValueError('偏好值无效')
                if value is not None and key in {'studio:convert-particles', 'studio:preview-translation', 'studio:preview-romanization', 'studio:preview-hide'} and value not in {'true', 'false'}:
                    raise ValueError('设置值必须为布尔值')
                if value is not None and key == 'studio:preview-fade' and not 0.05 <= float(value) <= 1.5:
                    raise ValueError('渐变宽度必须在 0.05 到 1.5 之间')
                if value is not None and key == 'studio:alignment-defaults':
                    defaults = json.loads(value)
                    flags = {'latin_normalize', 'strip_tone_digits', 'use_hints', 'line_blank', 'rest_blank', 'rest_token', 'clear_unmatched', 'smart_extend', 'merge_short_gaps'}
                    if not isinstance(defaults, dict) or set(defaults) - (flags | {'gap_threshold_ms'}) or any(type(v) is not bool for k, v in defaults.items() if k in flags):
                        raise ValueError('对齐默认参数无效')
                    threshold = defaults.get('gap_threshold_ms', 500)
                    if type(threshold) is not int or not 0 < threshold <= 9007199254740991:
                        raise ValueError('行内空隙阈值必须为正的安全整数毫秒')
                if value is not None and key == 'studio:alignment-model':
                    model = json.loads(value)
                    if not isinstance(model, dict) or set(model) != {'name', 'type'} or not all(isinstance(v, str) and v for v in model.values()) or model['name'] in {'.', '..'} or '/' in model['name'] or '\\' in model['name']:
                        raise ValueError('默认模型需要子目录名和模型类型')
                if key == 'studio:ui-language' and value not in UI_LANGUAGES: raise ValueError('界面语言未注册')
                if key.startswith('device.') and value not in {'auto', 'cpu'}: raise ValueError('设备只能选择自动或 CPU')
                if key == 'alignment.models_dir' and value is not None:
                    if not Path(value).is_absolute(): raise ValueError('模型总目录必须为绝对路径')
                    list(Path(value).iterdir())
                if key == 'port' and (not value or not value.isdecimal() or not 1024 <= int(value) <= 65535): raise ValueError('端口范围为 1024–65535')
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
            return response(settings.patch(body.changes, int(if_match.strip('"'))))
        except SettingsConflict:
            raise HTTPException(409, {'code': 'settings_conflict', 'message': '偏好已在另一页面修改，请刷新后重试', 'retryable': True})
        except ValueError as exc:
            raise HTTPException(422, str(exc))
    return router
