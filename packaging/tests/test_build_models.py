from pathlib import Path
import hashlib
import json
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import build_models
from download_models import extract_model


def test_model_archives_install_and_failed_download_can_retry(tmp_path, monkeypatch):
    source = tmp_path / 'weights'
    source.write_bytes(b'original weights')
    manifest = {}
    for family, directory in [('nextfire','NextFire-karaoke-ja-Latn'), ('mms_fa','MMS_FA')]:
        manifest[family] = {'directory':directory,'source':source.as_uri(),'license':'fixture',
            'license_url':'https://example.com/license','files':[{'name':'model.pt','size':source.stat().st_size,
            'sha256':hashlib.sha256(source.read_bytes()).hexdigest()}]}
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
    assert len(build_models.build(output,cache)) == 2
    for spec in manifest.values():
        name=spec['directory']
        model=extract_model(output/(name+'.zip'),tmp_path/'unpacked',name)
        assert (model/'model.pt').read_bytes() == b'original weights'
        assert json.loads((model/'SOURCE.json').read_text())['source']==source.as_uri()
