import io
from pathlib import Path
import os
import sys
import tarfile
import zipfile

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from archive import digest, download, extract, package


def test_download_rejects_bad_identity_and_cleans_partial(tmp_path):
    source = tmp_path / 'source'
    source.write_bytes(b'actual')
    target = tmp_path / 'cache/file'
    with pytest.raises(ValueError, match='摘要'):
        download(source.as_uri(), target, '0' * 64)
    assert not target.exists()
    assert not target.with_suffix('.partial').exists()
    download(source.as_uri(), target, digest(source), source.stat().st_size)
    source.unlink()
    assert download(source.as_uri(), target, digest(target)) == target


@pytest.mark.parametrize('name', ['../escape', '/absolute', 'C:/drive', 'foo\\bar', 'dir/../../escape'])
@pytest.mark.parametrize('zip_separator', ['/', '\\'])
def test_zip_rejects_paths_outside_destination(tmp_path, monkeypatch, name, zip_separator):
    archive = tmp_path / 'input.zip'
    # Exercise both ZipInfo separator conventions on every test host.
    monkeypatch.setattr(zipfile.os, 'sep', zip_separator)
    entry = zipfile.ZipInfo(name)
    entry.filename = name  # Preserve the hostile name instead of normalizing it on write.
    with zipfile.ZipFile(archive, 'w') as target:
        target.writestr(entry, 'bad')
    with zipfile.ZipFile(archive) as source:
        assert source.infolist()[0].orig_filename == name
    with pytest.raises(ValueError):
        extract(archive, tmp_path / 'out')


def test_tar_rejects_escaping_symlink(tmp_path):
    archive = tmp_path / 'input.tar'
    with tarfile.open(archive, 'w') as target:
        info = tarfile.TarInfo('escape')
        info.type = tarfile.SYMTYPE
        info.linkname = '../../outside'
        target.addfile(info)
    with pytest.raises(tarfile.FilterError):
        extract(archive, tmp_path / 'out')


def test_single_zip_reconstructs_complete_folder_and_permissions(tmp_path):
    root = tmp_path / 'LazuliteStudio-macos-arm64'
    for path in ('app/a', 'runtime/python/a', 'runtime/python/b', 'models/a', 'start.command'):
        file = root / path
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_bytes(os.urandom(12000))
    (root / 'start.command').chmod(0o755)
    archive = package(root, tmp_path / 'archives')
    assert list((tmp_path / 'archives').iterdir()) == [archive]
    with zipfile.ZipFile(archive) as source:
        assert all(name.startswith(root.name + '/') for name in source.namelist())
        assert not any(name.endswith('.zip') for name in source.namelist())
    extract(archive, tmp_path / 'extracted')
    for file in root.rglob('*'):
        if file.is_file():
            relocated = tmp_path / 'extracted' / root.name / file.relative_to(root)
            assert digest(relocated) == digest(file)
    if os.name != 'nt':
        assert (tmp_path / 'extracted' / root.name / 'start.command').stat().st_mode & 0o111
    with pytest.raises(ValueError, match='重复'):
        extract(archive, tmp_path / 'extracted')


def test_small_package_uses_one_zip(tmp_path):
    root = tmp_path / 'Studio'
    root.mkdir()
    (root / 'manifest.json').write_text('{}')
    result = package(root, tmp_path / 'out')
    assert result.name == 'Studio.zip'
