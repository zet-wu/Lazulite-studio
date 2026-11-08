from pathlib import Path
import sys
from unittest.mock import Mock

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import release


def assets(root):
    names = [f'LazuliteStudio-{target}.7z' for target in release.TARGETS] + sorted(release.MODEL_ASSETS)
    for name in names:
        (root / name).write_bytes(b'asset')
    return names


def test_requires_models_and_contiguous_main_volumes(tmp_path):
    assets(tmp_path)
    assert len(release.assets_in(tmp_path)) == 5
    cpu = tmp_path / 'LazuliteStudio-windows-x64-cpu.7z'
    cpu.rename(cpu.with_suffix('.7z.001'))
    with pytest.raises(ValueError):
        release.assets_in(tmp_path)
    cpu.with_suffix('.7z.002').write_bytes(b'volume')
    assert len(release.assets_in(tmp_path)) == 6
    (tmp_path / 'MMS_FA.zip').unlink()
    with pytest.raises(ValueError, match='模型附件缺失'):
        release.assets_in(tmp_path)


def test_draft_replaces_managed_assets_but_preserves_other_assets(tmp_path, monkeypatch):
    names = assets(tmp_path)
    monkeypatch.setenv('RELEASE_TAG', 'v1')
    monkeypatch.setenv('RELEASE_COMMIT', 'commit')
    response = Mock(side_effect=[[], [[{'tag_name':'v1','draft':True,'assets':[
        {'name':name} for name in names + ['user-notes.txt']]}]]])
    monkeypatch.setattr(release, 'api', response)
    calls = Mock()
    monkeypatch.setattr(release.subprocess, 'run', calls)
    release.prepare_draft(tmp_path)
    deleted = [call.args[0][4] for call in calls.call_args_list if call.args[0][2] == 'delete-asset']
    assert set(deleted) == set(names)
    assert sum(call.args[0][2] == 'upload' for call in calls.call_args_list) == 5


@pytest.mark.parametrize('moved', [False, True])
def test_published_release_or_moved_tag_never_mutated(tmp_path, monkeypatch, moved):
    assets(tmp_path)
    monkeypatch.setenv('RELEASE_TAG', 'v1')
    monkeypatch.setenv('RELEASE_COMMIT', 'commit')
    replies = [[{'ref':'refs/tags/v1'}], {'sha':'different'}] if moved else [[], [[{'tag_name':'v1','draft':False}]]]
    monkeypatch.setattr(release, 'api', Mock(side_effect=replies))
    run = Mock()
    monkeypatch.setattr(release.subprocess, 'run', run)
    with pytest.raises(ValueError):
        release.prepare_draft(tmp_path)
    run.assert_not_called()
