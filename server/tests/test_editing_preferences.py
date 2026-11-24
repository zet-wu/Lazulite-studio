import pytest
from server.runtime_settings import RuntimeSettings


def test_background_defaults_are_independent_library_booleans(tmp_path):
    path=tmp_path/'settings.json';settings=RuntimeSettings(path)
    settings.patch({'studio:background-skip-alignment':'false','studio:background-skip-sync':'true'},0)
    reopened=RuntimeSettings(path);state=reopened.read()
    assert state['values']['studio:background-skip-alignment']=='false'
    assert state['values']['studio:background-skip-sync']=='true'
    with pytest.raises(ValueError):reopened.patch({'studio:background-skip-sync':'yes'},state['revision'])
    assert reopened.read()==state


def test_sync_style_and_audio_defaults_persist_and_reject_invalid_options(tmp_path):
    import json
    settings=RuntimeSettings(tmp_path/'settings.json')
    for style in ('sug','amll'):
        settings.patch({'studio:sync-style':style,'studio:alignment-defaults':json.dumps({'audio_source':'original','crop_vocals':False})},settings.read()['revision'])
        saved=RuntimeSettings(settings.path).read()
        assert saved['values']['studio:sync-style']==style
        assert json.loads(saved['values']['studio:alignment-defaults'])=={'audio_source':'original','crop_vocals':False}
    for changes in [{'studio:sync-style':'invalid'},{'studio:alignment-defaults':'{"audio_source":"invalid"}'},{'studio:alignment-defaults':'{"crop_vocals":1}'}]:
        with pytest.raises(ValueError):settings.patch(changes,settings.read()['revision'])
