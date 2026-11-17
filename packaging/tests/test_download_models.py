from pathlib import Path
import sys
import zipfile

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import download_models as downloader


def archive(path, name='MMS_FA', members=None):
    with zipfile.ZipFile(path, 'w') as stream:
        for member, data in (members or [(name + '/model.pt', b'weights')]):
            stream.writestr(member, data)
    return path.as_uri()


def test_install_skip_failure_retry_and_own_cleanup(tmp_path):
    root = tmp_path / '程序 with spaces'
    root.mkdir()
    (root / 'tmp').mkdir()
    (root / 'tmp/user.txt').write_text('keep')
    url = archive(tmp_path / 'source.zip')
    downloader.install(root, 'MMS_FA', url)
    assert (root / 'models/MMS_FA/model.pt').read_bytes() == b'weights'
    downloader.install(root, 'MMS_FA', 'invalid:never-requested')
    with pytest.raises(Exception):
        downloader.install(root, 'NextFire-karaoke-ja-Latn', url)
    assert not (root / 'models/NextFire-karaoke-ja-Latn').exists()
    url = archive(tmp_path / 'source.zip', 'NextFire-karaoke-ja-Latn')
    downloader.install(root, 'NextFire-karaoke-ja-Latn', url)
    assert list((root / 'tmp').iterdir()) == [root / 'tmp/user.txt']


@pytest.mark.parametrize('member', ['/MMS_FA/model.pt','MMS_FA/../../escape','MMS_FA/../escape',
    'C:/escape','MMS_FA\\escape','other/model.pt','MMS_FA'])
def test_reject_bad_paths_without_partial_model(tmp_path, member):
    url = archive(tmp_path / 'source.zip', members=[('MMS_FA/valid', b'ok'), (member,b'bad')])
    with pytest.raises((ValueError, OSError)):
        downloader.install(tmp_path, 'MMS_FA', url)
    assert not (tmp_path / 'models/MMS_FA').exists()
    assert list((tmp_path / 'tmp').iterdir()) == []


def test_corrupt_zip_and_cancel_clean_staging(tmp_path, monkeypatch):
    path = tmp_path / 'source.zip'
    path.write_bytes(b'partial zip')
    with pytest.raises(zipfile.BadZipFile):
        downloader.install(tmp_path, 'MMS_FA', path.as_uri())
    def cancel(*args, **kwargs):
        raise KeyboardInterrupt
    monkeypatch.setattr(downloader.urllib.request, 'urlopen', cancel)
    with pytest.raises(KeyboardInterrupt):
        downloader.install(tmp_path, 'MMS_FA', path.as_uri())
    assert list((tmp_path / 'tmp').iterdir()) == []
    assert not (tmp_path / 'models/MMS_FA').exists()


def test_menu_all_retains_success_and_retries_failed_item(tmp_path, monkeypatch):
    first = archive(tmp_path / 'first.zip', 'NextFire-karaoke-ja-Latn')
    missing = tmp_path / 'missing.zip'
    config = {'models': {'NextFire-karaoke-ja-Latn': first, 'MMS_FA': missing.as_uri()}}
    answers = iter(['3','0'])
    monkeypatch.setattr('builtins.input', lambda _: next(answers))
    downloader.menu(tmp_path, config)
    assert (tmp_path / 'models/NextFire-karaoke-ja-Latn').is_dir()
    assert not (tmp_path / 'models/MMS_FA').exists()
    archive(missing)
    answers = iter(['2','0'])
    downloader.menu(tmp_path, config)
    assert (tmp_path / 'models/MMS_FA/model.pt').exists()


def test_crc_failure_and_symlinks_are_not_installed(tmp_path):
    path = tmp_path / 'source.zip'
    archive(path)
    path.write_bytes(path.read_bytes().replace(b'weights', b'corrupt'))
    with pytest.raises(zipfile.BadZipFile):
        downloader.install(tmp_path, 'MMS_FA', path.as_uri())
    with zipfile.ZipFile(path, 'w') as stream:
        item = zipfile.ZipInfo('MMS_FA/link')
        item.external_attr = (0o120777 << 16)
        stream.writestr(item, '/outside')
    with pytest.raises(ValueError, match='路径非法'):
        downloader.install(tmp_path, 'MMS_FA', path.as_uri())
    assert not (tmp_path / 'models/MMS_FA').exists()
    assert list((tmp_path / 'tmp').iterdir()) == []


def vocal_archive(path, missing=None):
    return archive(path, 'bs-karaoke', [
        ('bs-karaoke/' + name, b'fixture') for name in downloader.BS_FILES if name != missing])


@pytest.mark.parametrize('placeholder', [False, True])
def test_vocal_install_empty_or_missing_target_and_skip_existing(tmp_path, placeholder):
    root = tmp_path / '程序 with spaces'
    root.mkdir()
    target = root / 'vocal-models/bs-karaoke'
    if placeholder:
        target.mkdir(parents=True)
    url = vocal_archive(tmp_path / 'source.zip')
    downloader.install(root, 'bs-karaoke', url, category='vocal')
    assert all((target / name).read_bytes() == b'fixture' for name in downloader.BS_FILES)
    downloader.install(root, 'bs-karaoke', 'invalid:must-not-download', category='vocal')
    assert not (root / 'models').exists()
    assert not list((root / 'tmp').iterdir())


@pytest.mark.parametrize('missing', downloader.BS_FILES)
def test_incomplete_vocal_zip_preserves_placeholder_and_retries(tmp_path, missing):
    target = tmp_path / 'vocal-models/bs-karaoke'
    target.mkdir(parents=True)
    url = vocal_archive(tmp_path / 'source.zip', missing)
    with pytest.raises(ValueError, match='缺少模型文件'):
        downloader.install(tmp_path, 'bs-karaoke', url, category='vocal')
    assert list(target.iterdir()) == []
    assert list((tmp_path / 'tmp').iterdir()) == []
    vocal_archive(tmp_path / 'source.zip')
    downloader.install(tmp_path, 'bs-karaoke', url, category='vocal')
    assert (target / missing).is_file()


@pytest.mark.parametrize('answer', ['Y', 'y', 'N', 'n', 'invalid\ny'])
def test_vocal_confirmation(tmp_path, monkeypatch, answer):
    answers = iter(answer.splitlines())
    monkeypatch.setattr('builtins.input', lambda _: next(answers))
    url = vocal_archive(tmp_path / 'source.zip')
    downloader.vocal_menu(tmp_path, {'vocal_models': {'bs-karaoke': url}})
    assert (tmp_path / 'vocal-models/bs-karaoke').exists() == (answer.lower().endswith('y'))
    if answer.lower() == 'n':
        assert not (tmp_path / 'tmp').exists()


@pytest.mark.parametrize('phase', ['confirm', 'download'])
@pytest.mark.parametrize('error', [KeyboardInterrupt, EOFError])
def test_vocal_cancel_cleans_only_own_files(tmp_path, monkeypatch, phase, error):
    import json
    monkeypatch.setattr(downloader, '__file__', str(tmp_path / 'download_models.py'))
    (tmp_path / 'model-downloads.json').write_text(json.dumps({'vocal_models': {'bs-karaoke': 'unused'}}))
    (tmp_path / 'tmp').mkdir()
    (tmp_path / 'tmp/user.txt').write_text('keep')
    def cancel(*args, **kwargs):
        raise error()
    monkeypatch.setattr('builtins.input', cancel if phase == 'confirm' else lambda _: 'y')
    monkeypatch.setattr(downloader.urllib.request, 'urlopen', cancel)
    assert downloader.main('vocal') == 0
    assert sorted(p.name for p in (tmp_path / 'tmp').iterdir()) == ['user.txt']
    assert not (tmp_path / 'vocal-models/bs-karaoke').exists()


@pytest.mark.parametrize('location', ['vocal-models', 'vocal-models/bs-karaoke', 'tmp'])
def test_vocal_rejects_symlink_destinations(tmp_path, location):
    root = tmp_path / 'package'; root.mkdir()
    outside = tmp_path / 'outside'; outside.mkdir()
    link = root / location
    link.parent.mkdir(parents=True, exist_ok=True)
    link.symlink_to(outside, target_is_directory=True)
    with pytest.raises(ValueError):
        downloader.install(root, 'bs-karaoke', 'invalid:never-downloaded', category='vocal')
    assert list(outside.iterdir()) == []


def test_vocal_concurrent_target_preserved(tmp_path, monkeypatch):
    url = vocal_archive(tmp_path / 'source.zip')
    extract = downloader.extract_model
    def concurrent(*args):
        model = extract(*args)
        target = tmp_path / 'vocal-models/bs-karaoke'
        target.mkdir()
        (target / 'user.txt').write_text('keep')
        return model
    monkeypatch.setattr(downloader, 'extract_model', concurrent)
    with pytest.raises(FileExistsError):
        downloader.install(tmp_path, 'bs-karaoke', url, category='vocal')
    assert (tmp_path / 'vocal-models/bs-karaoke/user.txt').read_text() == 'keep'
    assert list((tmp_path / 'tmp').iterdir()) == []
