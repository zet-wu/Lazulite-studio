from pathlib import Path
import hashlib
import json
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import build_models
from download_models import extract_model, install, BS_FILES


def test_model_archives_install_and_failed_download_can_retry(tmp_path, monkeypatch):
    source = tmp_path / 'weights'
    source.write_bytes(b'original weights')
    manifest = {}
    for family, directory in [('nextfire','NextFire-karaoke-ja-Latn'), ('mms_fa','MMS_FA'), ('bs_karaoke','bs-karaoke')]:
        manifest[family] = {'directory':directory,'source':source.as_uri(),'license':'fixture',
            'license_url':'https://example.com/license','files':[{'name':name,'size':source.stat().st_size,
            'sha256':hashlib.sha256(source.read_bytes()).hexdigest()}
            for name in (BS_FILES if family == 'bs_karaoke' else ('model.pt',))]}
    config = tmp_path / 'models.json'
    config.write_text(json.dumps(manifest))
    monkeypatch.setattr(build_models, 'ROOT', tmp_path)
    cache=tmp_path/'cache';cache.mkdir()
    output=tmp_path/'output'
    source.write_bytes(b'bad download')
    with pytest.raises(ValueError):
        build_models.build(output,cache)
    assert not list(output.iterdir())
    source.write_bytes(b'original weights')
    assert len(build_models.build(output,cache)) == 3
    for spec in manifest.values():
        name=spec['directory']
        model=extract_model(output/(name+'.zip'),tmp_path/'unpacked',name)
        for item in spec['files']:
            assert (model/item['name']).read_bytes() == b'original weights'
        assert json.loads((model/'SOURCE.json').read_text())['source']==source.as_uri()

        assert (model/'alignment-model.json').exists() == (name == 'MMS_FA')

    package = tmp_path/'package'; package.mkdir()
    install(package, 'bs-karaoke', (output/'bs-karaoke.zip').as_uri(), category='vocal')
    assert all((package/'vocal-models/bs-karaoke'/name).is_file() for name in BS_FILES)
