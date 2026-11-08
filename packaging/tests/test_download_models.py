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
