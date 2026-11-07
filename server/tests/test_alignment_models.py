import json
from pathlib import Path
import pytest
from server.alignment_models import AlignmentModels, check_snapshot
from server.runtime_settings import RuntimeSettings


def model(root, name='model'):
    path=root/name;path.mkdir(parents=True)
    (path/'alignment-model.json').write_text(json.dumps({'type':'torchaudio-mms-fa','weights':'model.pt'}))
    (path/'model.pt').write_bytes(b'weight placeholder: scan must not deserialize')
    return path


def test_catalog_refresh_and_frozen_snapshot(tmp_path, monkeypatch):
    root=tmp_path/'models'; selected=model(root)
    (root/'unrelated').mkdir()
    (root/'unrelated/config.json').write_text('{"model_type":"bert"}')
    broken=model(root,'broken');(broken/'model.pt').unlink()
    monkeypatch.setenv('STUDIO_ALIGNMENT_MODELS_DIR',str(root))
    catalog=AlignmentModels();items=catalog.scan()['items']
    assert len(items)==2 and items[0]['status']=='invalid'
    identity=items[1]['id']; options={'latin_normalize':True,'strip_tone_digits':False}
    key,snapshot=catalog.preview(identity,options)
    assert catalog.scan(True)['items'][1]['id']==identity
    other=tmp_path/'other';model(other)
    monkeypatch.setenv('STUDIO_ALIGNMENT_MODELS_DIR',str(other))
    assert catalog.scan()['items'][0]['id']!=identity
    assert catalog.capture(key,options)==snapshot
    with pytest.raises(ValueError): catalog.capture(key,{**options,'strip_tone_digits':True})
    (selected/'model.pt').write_bytes(b'replaced')
    with pytest.raises(ValueError,match='改变'): check_snapshot(snapshot)
    (other/'model').rename(other/'renamed')
    assert catalog.scan(True)['items'][0]['name']=='renamed'
    monkeypatch.setenv('STUDIO_ALIGNMENT_MODELS_DIR',str(tmp_path/'missing'))
    assert catalog.scan()['error'] and not catalog.scan()['items']


def test_portable_default_and_applied_path(tmp_path):
    package=tmp_path/'包 root';package.mkdir();(package/'models').mkdir()
    settings=RuntimeSettings(package/'settings.json');catalog=AlignmentModels(settings,package)
    assert catalog.scan()['items']==[]
    custom=tmp_path/'自定义 models';model(custom)
    catalog.apply(str(custom));assert catalog.directory()==custom
    with pytest.raises(FileNotFoundError):catalog.apply(str(tmp_path/'missing'))
    assert catalog.directory()==custom
    catalog.apply(None);assert 'alignment.models_dir' not in settings.read()['values']
    moved=tmp_path/'moved';package.rename(moved)
    settings=RuntimeSettings(moved/'settings.json')
    assert AlignmentModels(settings,moved).directory()==moved/'models'
    with pytest.raises(ValueError):AlignmentModels().apply(str(custom))
