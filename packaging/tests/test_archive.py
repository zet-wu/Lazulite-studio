import io
from pathlib import Path
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


def test_package_dereferences_file_symlinks_and_rejects_bad_symlinks(tmp_path, monkeypatch):
    root = tmp_path / 'pkg'
    root.mkdir()
    (root / 'real.txt').write_text('hello')
    (root / 'alias.txt').symlink_to(root / 'real.txt')
    out = tmp_path / 'out'

    monkeypatch.setattr('archive.seven_zip', lambda: '7zz')
    def fake_run(cmd, **kwargs):
        (out / f'{root.name}.7z.001').write_bytes(b'7z')
    monkeypatch.setattr('archive.subprocess.run', fake_run)

    archives = package(root, out)
    assert archives == [out / f'{root.name}.7z']
    assert not (root / 'alias.txt').is_symlink()
    assert (root / 'alias.txt').read_text() == 'hello'

    sub = root / 'sub'
    sub.mkdir()
    (root / 'dirlink').symlink_to(sub, target_is_directory=True)
    with pytest.raises(ValueError, match='目录符号链接'):
        package(root, out)
    (root / 'dirlink').unlink()

    outside = tmp_path / 'outside.txt'
    outside.write_text('escape')
    (root / 'escape.txt').symlink_to(outside)
    with pytest.raises(ValueError, match='越界'):
        package(root, out)
