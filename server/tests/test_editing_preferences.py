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
