"""Install release model ZIPs using only the bundled Python standard library."""
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import stat
import tempfile
import urllib.request
import zipfile


def extract_model(archive, destination, name):
    with zipfile.ZipFile(archive) as source:
        members = source.infolist()
        if not members:
            raise ValueError('模型 ZIP 为空')
        for item in members:
            raw = item.orig_filename
            path = PurePosixPath(raw)
            if (path.is_absolute() or '..' in path.parts or '\\' in raw or ':' in raw
                    or '\0' in raw or not path.parts or path.parts[0] != name
                    or stat.S_ISLNK(item.external_attr >> 16)):
                raise ValueError(f'模型 ZIP 路径非法：{raw}')
            target = destination.joinpath(*path.parts)
            if item.is_dir():
                target.mkdir(parents=True, exist_ok=True)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                # Reading every member to EOF validates its CRC without a second scan.
                with source.open(item) as stream, target.open('xb') as output:
                    shutil.copyfileobj(stream, output)
        model = destination / name
        if not model.is_dir() or not any(p.is_file() for p in model.rglob('*')):
            raise ValueError('模型 ZIP 缺少预期模型目录或文件')
    return model


BS_FILES = ('bs_roformer_karaoke_frazer_becruily.ckpt', 'config_karaoke_frazer_becruily.yaml')


def install(root, name, url, *, category='align'):
    models = root / {'align': 'models', 'vocal': 'vocal-models'}[category]
    temporary = root / 'tmp'
    # Keep staging and installation physically inside this package.
    for folder in (models, temporary):
        if folder.is_symlink() or not folder.resolve().is_relative_to(root.resolve()):
            raise ValueError(f'包内目录不能指向外部：{folder}')
        folder.mkdir(exist_ok=True)
    target = models / name
    if target.is_symlink():
        raise ValueError(f'模型目标不能是符号链接：{target}')
    if os.path.lexists(target) and (not target.is_dir() or any(target.iterdir())):
        print(f'跳过已存在的目标：{target}（未校验模型；异常目录请自行处理后重试）')
        return
    print(f'安装到：{target}')
    with tempfile.TemporaryDirectory(prefix='models-', dir=temporary) as work:
        work = Path(work)
        archive = work / 'model.zip'
        with urllib.request.urlopen(url, timeout=120) as response, archive.open('wb') as output:
            size = response.headers.get('Content-Length')
            total = int(size) if size else None
            received = 0
            while block := response.read(1024 * 1024):
                output.write(block)
                received += len(block)
                print(f'\r已下载 {received / 1024**2:.1f} MB' + (f' / {total / 1024**2:.1f} MB' if total else ''), end='', flush=True)
            print()
            if total is not None and received != total:
                raise ValueError('下载不完整')
        model = extract_model(archive, work / 'unpacked', name)
        if category == 'vocal':
            for filename in BS_FILES:
                file = model / filename
                if not file.is_file() or file.stat().st_size == 0:
                    raise ValueError(f'缺少模型文件：{filename}')
        if target.is_symlink():
            raise ValueError(f'模型目标不能是符号链接：{target}')
        if os.path.lexists(target):
            if not target.is_dir() or any(target.iterdir()):
                raise FileExistsError(f'目标已由其他操作创建，请重新运行：{target}')
            target.rmdir()  # Only remove an empty placeholder after extraction succeeds.
        model.rename(target)
    print(f'安装完成：{target}')


def menu(root, config):
    names = list(config['models'])
    while True:
        print('\n请选择要下载的对齐模型：\n1. NextFire-karaoke-ja-Latn\n2. MMS_FA\n3. 全部下载\n0. 退出')
        choice = input('> ').strip()
        if choice == '0':
            return
        if choice not in ('1', '2', '3'):
            print('请输入 0、1、2 或 3')
            continue
        selected = names if choice == '3' else [names[int(choice) - 1]]
        for name in selected:
            try:
                install(root, name, config['models'][name])
            except Exception as error:
                print(f'{name} 安装失败：{error}；可重新运行重试。')
        print('请在设置的模型管理中刷新。若使用自定义模型总目录，请恢复默认或自行将模型移入该目录。')


def vocal_menu(root, config):
    while True:
        choice = input('下载并安装 BS Karaoke？[Y/N] ').strip().lower()
        if choice == 'n':
            return
        if choice == 'y':
            install(root, 'bs-karaoke', config['vocal_models']['bs-karaoke'], category='vocal')
            print('请在设置的人声分离模型中刷新并选择 BS Karaoke。若使用自定义总目录，请恢复默认或自行移入该目录。')
            return
        print('请输入 Y 或 N')


def main(category):
    root = Path(__file__).resolve().parent
    try:
        config = json.loads((root / 'model-downloads.json').read_text(encoding='utf-8'))
        (menu if category == 'align' else vocal_menu)(root, config)
    except (KeyboardInterrupt, EOFError):
        print('\n已取消，已完成的模型保留。')
    except Exception as error:
        print(f'无法下载模型：{error}；可重新运行重试。')
        return 1
    return 0
