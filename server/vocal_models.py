"""Lightweight local vocal-model catalog and immutable task resources."""
import os
from pathlib import Path
from .alignment_models import AlignmentModels

BS_FILES = ('bs_roformer_karaoke_frazer_becruily.ckpt', 'config_karaoke_frazer_becruily.yaml')


def check_snapshot(snapshot):
    for item in snapshot['files']:
        path = Path(item['path'])
        if not path.is_file() or path.stat().st_size != item['size'] or path.stat().st_mtime_ns != item['mtime_ns']:
            raise ValueError('人声模型文件已改变，请刷新并重新发起任务')


def separator_for(snapshot, device):
    check_snapshot(snapshot)
    if snapshot['type'] == 'bs-karaoke':
        if device not in {'cpu', 'cuda'}:
            raise ValueError('BS Karaoke 当前支持 CPU 或 NVIDIA GPU，请选择 CPU 或其他模型')
        from lazulite.audio.bs_karaoke import BSKaraokeConfig, BSKaraokeSeparator
        return BSKaraokeSeparator(BSKaraokeConfig(**snapshot['config'], device=device))
    from lazulite.audio.separation import DemucsConfig, DemucsSeparator
    return DemucsSeparator(DemucsConfig(**snapshot['config'], device=device))


class VocalModels(AlignmentModels):
    def directory(self):
        if self.package_root is not None:
            custom = self.settings.read()['values'].get('vocal.models_dir')
            return Path(custom) if custom else self.package_root / 'vocal-models'
        value = os.getenv('STUDIO_VOCAL_MODELS_DIR')
        return Path(value) if value else None

    def describe(self, kind):
        root = self.directory()
        path = root / kind if root else Path(os.environ['STUDIO_DEMUCS_REPO']) if kind == 'demucs' and os.getenv('STUDIO_DEMUCS_REPO') else None
        if path is None:
            raise ValueError('人声模型总目录尚未配置')
        if kind == 'bs-karaoke':
            files = [path / name for name in BS_FILES]
        else:
            import yaml
            description = path / 'htdemucs.yaml'
            try: models = yaml.safe_load(description.read_text())['models']
            except yaml.YAMLError as exc: raise ValueError('Demucs 配置无法读取') from exc
            files = [description]
            for signature in models:
                weights = sorted(path.glob(f'{signature}-*.th'))
                if len(weights) != 1: raise ValueError(f'缺少或存在重复的 Demucs 权重：{signature}')
                files.extend(weights)
        states = []
        for file in files:
            if not file.is_file() or file.stat().st_size == 0:
                raise ValueError(f'缺少模型文件：{file.name}')
            states.append({'path':str(file.resolve()), 'size':file.stat().st_size, 'mtime_ns':file.stat().st_mtime_ns})
        config = {'model_repo':str(path.resolve())}
        if kind == 'demucs':
            from lazulite.audio.separation import DemucsConfig
            from dataclasses import asdict
            config = asdict(DemucsConfig(model_repo=str(path.resolve())))
            config.pop('device')
        return {'type':kind, 'name':'BS Karaoke' if kind == 'bs-karaoke' else 'Demucs', 'config':config, 'files':states,
                **({'configuration_yaml':(path / BS_FILES[1]).read_text()} if kind == 'bs-karaoke' else {})}

    def scan(self, refresh=False):
        with self.lock:
            root = self.directory()
            cache_key = (str(root or ''), os.getenv('STUDIO_DEMUCS_REPO', ''))
            if not refresh and self.catalog is not None and getattr(self, '_scan_key', None) == cache_key:
                return self.catalog
            items = []
            for kind, name, target in [('demucs', 'Demucs', 'vocals'), ('bs-karaoke', 'BS Karaoke', 'lead')]:
                item = {'id': kind, 'type': kind, 'name': name, 'target': target}
                try:
                    self.describe(kind)
                    item['status'] = 'ready'
                except (OSError, ValueError, KeyError, TypeError) as exc:
                    item.update(status='invalid', reason=self.scan_error(exc, root))
                items.append(item)
            self._scan_key = cache_key
            self.catalog = {'directory': str(root or ''), 'editable': self.package_root is not None,
                            'source': 'portable' if self.package_root else 'environment', 'items': items, 'error': None}
            return self.catalog

    def apply(self, path):
        if self.package_root is None: raise ValueError('服务端目录由部署配置管理')
        if path is not None and (not isinstance(path,str) or not Path(path).is_absolute()):
            raise ValueError('模型总目录必须为绝对路径')
        list((Path(path) if path else self.package_root/'vocal-models').iterdir())
        current=self.settings.read()
        self.settings.patch({'vocal.models_dir':path},current['revision'])
        return self.scan(True)

    def capture(self, model_id=None):
        if model_id is not None and model_id not in ('demucs', 'bs-karaoke'): raise ValueError('人声模型 ID 无效')
        kind=model_id if model_id is not None else self.settings.read()['values'].get('studio:vocal-model','demucs')
        try: return self.describe(kind)
        except (KeyError, TypeError) as exc: raise ValueError('人声模型配置无效，请刷新并检查模型文件') from exc
