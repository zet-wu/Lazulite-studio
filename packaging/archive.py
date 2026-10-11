"""Verified downloads and independently extractable portable ZIP components."""
import hashlib
from pathlib import Path, PurePosixPath
import shutil
import stat
import tarfile
import urllib.request
import zipfile

# Leave room below the per-file 2 GiB release limit, including ZIP headers.
COMPONENT_LIMIT = 1900 * 1024 * 1024


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
        with urllib.request.urlopen(url, timeout=120) as source, partial.open('wb') as target:
            shutil.copyfileobj(source, target)
        if digest(partial) != sha256 or size is not None and partial.stat().st_size != size:
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
                target = member_path(root, item.filename)
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


def write_zip(path, root, files):
    with zipfile.ZipFile(path, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for file in files:
            if not file.resolve().is_relative_to(root.resolve()):
                raise ValueError(f'组件符号链接越界：{file}')
            # Dereference in-tree PBS symlinks, preserving executable permissions.
            info = zipfile.ZipInfo.from_file(file.resolve(), (Path(root.name) / file.relative_to(root)).as_posix())
            info.compress_type = zipfile.ZIP_DEFLATED
            with file.open('rb') as source, archive.open(info, 'w', force_zip64=True) as output:
                shutil.copyfileobj(source, output)


def package(root, output, limit=COMPONENT_LIMIT):
    root, output = Path(root), Path(output)
    output.mkdir(parents=True, exist_ok=True)
    files = sorted(p for p in root.rglob('*') if p.is_file())
    full = output / f'{root.name}.zip'
    write_zip(full, root, files)
    if full.stat().st_size < limit:
        return [full]
    full.unlink()
    result = []
    groups = {'app': [], 'runtime': [], 'models': []}
    for file in files:
        first = file.relative_to(root).parts[0]
        groups[first if first in ('runtime', 'models') else 'app'].append(file)
    for name, members in groups.items():
        chunk, size, index = [], 0, 1
        for file in members:
            # Conservative raw-byte budget leaves headroom for incompressible files.
            weight = file.stat().st_size + 4096
            if weight >= limit:
                raise ValueError(f'单一文件超过组件上限：{file.relative_to(root)}')
            if chunk and size + weight >= limit:
                path = output / f'{root.name}-{name}-{index}.zip'
                write_zip(path, root, chunk)
                result.append(path)
                chunk, size, index = [], 0, index + 1
            chunk.append(file)
            size += weight
        if chunk:
            path = output / f'{root.name}-{name}-{index}.zip'
            write_zip(path, root, chunk)
            result.append(path)
    if any(path.stat().st_size >= limit for path in result):
        raise ValueError('压缩组件仍超限')
    return result
