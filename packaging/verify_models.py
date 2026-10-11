"""Build-time full model identity check; never part of ordinary app startup."""
import argparse
import hashlib
import json
from pathlib import Path


def verify(root, manifest):
    for model in ('demucs', 'nextfire'):
        for item in manifest[model]['files']:
            path = root / model / item['name']
            if 'sha256' not in item or not path.is_file() or path.is_symlink(): raise ValueError(f'模型文件缺失或未锁定：{model}/{item["name"]}')
            if path.stat().st_size != item['size'] or hashlib.file_digest(path.open('rb'), 'sha256').hexdigest() != item['sha256']:
                raise ValueError(f'模型文件不完整：{model}/{item["name"]}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('root', type=Path)
    args = parser.parse_args()
    verify(args.root, json.loads(Path(__file__).with_name('models.json').read_text()))
    print('模型文件摘要与长度通过')
