"""Alignment catalog and frozen execution resources, independent of project data."""
from dataclasses import asdict
import os
from pathlib import Path
import threading
import uuid
from lazulite.alignment.japanese.backend import describe_model, UnsupportedModel
from lazulite.alignment.japanese.input import VERSION


def model_snapshot(path):
    path = Path(path).resolve()
    info = describe_model(path)
    return {'path': str(path), 'name': path.name, 'type': info['type'], 'input_version': VERSION,
            'vocabulary': info['vocabulary'], 'blank': info['blank'], 'columns': info['columns'],
            'frames': asdict(info['frames']), 'normalize': info['normalize'],
            'files': [{'path': str(f.resolve()), 'size': f.stat().st_size, 'mtime_ns': f.stat().st_mtime_ns} for f in info['files']]}


def check_snapshot(snapshot):
    try:
        if snapshot != model_snapshot(snapshot['path']):
            raise ValueError('模型文件已改变，请重新预览并发起任务')
    except (OSError, KeyError, TypeError) as exc:
        raise ValueError('模型文件已丢失或改变，请重新发起任务') from exc


class AlignmentModels:
    def __init__(self, settings=None, package_root=None):
        self.settings, self.package_root = settings, package_root
        self.catalog = None
        self.models = {}
        self.previews = {}
        self.lock = threading.RLock()

    def directory(self):
        if self.package_root is not None:
            custom = self.settings.read()['values'].get('alignment.models_dir')
            return Path(custom) if custom else self.package_root/'models'
        value = os.getenv('STUDIO_ALIGNMENT_MODELS_DIR')
        return Path(value) if value else None

    def scan(self, refresh=False):
        with self.lock:
            root = self.directory()
            if not refresh and self.catalog is not None and self.catalog['directory'] == str(root or ''):
                return self.catalog
            self.catalog = None
            previous = self.models; self.models = {}
            items = []
            error = None
            try:
                if root is None: raise ValueError('STUDIO_ALIGNMENT_MODELS_DIR is not configured')
                children = sorted(root.iterdir(), key=lambda p:p.name)
                for child in children:
                    if not child.is_dir(): continue
                    if not any((child/name).exists() for name in ('alignment-model.json','config.json','vocab.json')): continue
                    try:
                        snapshot = model_snapshot(child)
                        identity = next((key for key,value in previous.items() if value == snapshot), uuid.uuid4().hex)
                        self.models[identity] = snapshot
                        items.append({'id':identity,'name':child.name,'type':snapshot['type'],'status':'ready'})
                    except UnsupportedModel:
                        continue
                    except (OSError, ValueError, KeyError, TypeError) as exc:
                        items.append({'id':None,'name':child.name,'type':None,'status':'invalid','reason':str(exc)})
            except (OSError, ValueError) as exc:
                error = str(exc)
            self.catalog = {'directory':str(root or ''),'source':'portable' if self.package_root else 'environment',
                            'editable':self.package_root is not None,'items':items,'error':error}
            return self.catalog

    def apply(self, path):
        if self.package_root is None: raise ValueError('服务端目录由部署配置管理')
        if path is not None:
            if not isinstance(path,str) or not Path(path).is_absolute(): raise ValueError('模型总目录必须为绝对路径')
            root = Path(path)
        else: root = self.package_root/'models'
        # Empty directories are valid; fail before persisting inaccessible paths.
        list(root.iterdir())
        with self.lock:
            current = self.settings.read()
            self.settings.patch({'alignment.models_dir':path}, current['revision'])
            return self.scan(True)

    def select(self, identity):
        self.scan()
        if identity not in self.models: raise ValueError('所选模型不可用，请刷新并重新选择')
        value = self.models[identity]
        check_snapshot(value)
        return value

    def preview(self, model, options):
        with self.lock:
            snapshot = self.select(model)
            value = {'model':snapshot, **options}
            key = next((key for key,old in self.previews.items() if old == value), uuid.uuid4().hex)
            self.previews[key] = value
            return key, snapshot

    def capture(self, key, options):
        value = self.previews.get(key)
        if value is None or any(value[k] != v for k,v in options.items()):
            raise ValueError('模型或输入选项已改变，请重新预览')
        check_snapshot(value['model'])
        return value['model']
