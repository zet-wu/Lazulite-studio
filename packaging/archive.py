"""Verified downloads and portable 7z archives with optional volumes."""
import hashlib
import os
import subprocess
from pathlib import Path, PurePosixPath
import shutil
import stat
import tarfile
import urllib.request
import zipfile

def digest(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def download(url, destination, sha256, size=None):
    destination = Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.is_file() and digest(destination) == sha256:
        if size is None or destination.stat().st_size == size:
            return destination
    partial = destination.with_suffix(destination.suffix + '.partial')
    try:
        checksum = hashlib.sha256()
        with urllib.request.urlopen(url, timeout=120) as source, partial.open('wb') as target:
            while block := source.read(1024 * 1024):
                target.write(block)
                checksum.update(block)
        if checksum.hexdigest() != sha256 or size is not None and partial.stat().st_size != size:
            raise ValueError(f'下载摘要或大小不匹配：{url}')
        partial.replace(destination)
    finally:
        partial.unlink(missing_ok=True)
    return destination


def member_path(root, name):
    # Reject Windows paths even when validating on a POSIX build machine.
    path = PurePosixPath(name)
    if path.is_absolute() or '..' in path.parts or '\\' in name or ':' in name:
        raise ValueError(f'归档路径非法：{name}')
    result = root.joinpath(*path.parts)
    if not result.resolve().is_relative_to(root.resolve()):
        raise ValueError(f'归档路径越界：{name}')
    return result


def extract(archive, root):
    root = Path(root)
    root.mkdir(parents=True, exist_ok=True)
    if zipfile.is_zipfile(archive):
        with zipfile.ZipFile(archive) as source:
            for item in source.infolist():
                # ZipInfo normalizes backslashes on Windows; validate before that
                # transformation so admission rules do not depend on the host OS.
                target = member_path(root, item.orig_filename)
                mode = item.external_attr >> 16
                if stat.S_ISLNK(mode):
                    raise ValueError('ZIP 不允许符号链接')
                if item.is_dir():
                    target.mkdir(parents=True, exist_ok=True)
                    continue
                target.parent.mkdir(parents=True, exist_ok=True)
                if target.exists():
                    raise ValueError(f'组件路径重复：{item.filename}')
                with source.open(item) as stream, target.open('wb') as output:
                    shutil.copyfileobj(stream, output)
                if mode & 0o111:
                    target.chmod(0o755)
    else:
        with tarfile.open(archive) as source:
            # PBS contains relative symlinks; Python's data filter checks their targets.
            source.extractall(root, filter='data')


def seven_zip():
    executable = os.environ.get('STUDIO_7ZIP') or shutil.which('7zz') or shutil.which('7z')
    if not executable:
        raise RuntimeError('构建需要 7-Zip；先运行 packaging/setup_7zip.py')
    return executable


def package(root, output, volume_size=1900 * 1024 * 1024):
    root, output = Path(root).resolve(), Path(output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    for path in root.rglob('*'):
        if not path.resolve().is_relative_to(root):
            raise ValueError(f'归档符号链接越界：{path}')
    # PBS aliases must remain usable with extractors that do not restore links.
    for path in sorted(root.rglob('*')):
        if path.is_symlink():
            if not path.is_file():
                raise ValueError(f'不支持归档目录符号链接：{path}')
            source = path.resolve()
            path.unlink()
            shutil.copy2(source, path)
    archive = output / f'{root.name}.7z'
    # Bounded solid blocks and dictionary keep extraction memory practical.
    subprocess.run([seven_zip(), 'a', '-t7z', '-mx=7', '-m0=LZMA2', '-md=64m',
                    '-ms=256m', '-mmt=2', f'-v{volume_size}b', str(archive), root.name],
                   cwd=root.parent, check=True)
    volumes = sorted(output.glob(archive.name + '.*'))
    if not volumes:
        raise RuntimeError('7-Zip 没有生成分卷')
    if len(volumes) == 1:
        volumes[0].rename(archive)
        return [archive]
    return volumes


def extract_package(first_volume, destination):
    # Only for our newly built, verified archive, not arbitrary user input.
    destination = Path(destination).resolve()
    destination.mkdir(parents=True, exist_ok=True)
    if any(destination.iterdir()):
        raise ValueError('验证解包目录必须为空')
    subprocess.run([seven_zip(), 'x', '-y', str(Path(first_volume).resolve()),
                    '-o' + str(destination)], check=True)
