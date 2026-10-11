from pathlib import Path
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import release


def archives(root):
    names = ['LazuliteStudio-windows-x64-cpu.7z', 'LazuliteStudio-macos-arm64.7z',
             'LazuliteStudio-windows-x64-cuda.7z.001', 'LazuliteStudio-windows-x64-cuda.7z.002']
    for name in names:
        (root / name).write_bytes(b'archive')
    return names


def test_release_rejects_missing_platform_and_volume_gap(tmp_path):
    names = archives(tmp_path)
    assert len(release.assets_in(tmp_path)) == 4
    (tmp_path / names[-1]).rename(tmp_path / names[-1].replace('002', '003'))
    with pytest.raises(ValueError, match='分卷'):
        release.assets_in(tmp_path)
    (tmp_path / names[0]).unlink()
    with pytest.raises(ValueError, match='附件缺失'):
        release.assets_in(tmp_path)


@pytest.fixture
def draft_setup(tmp_path, monkeypatch):
    archives(tmp_path)
    monkeypatch.setenv('RELEASE_TAG', 'v0.1.0-preview')
    monkeypatch.setenv('RELEASE_COMMIT', 'abc')
    state = {'refs': [], 'releases': [[]], 'sha': 'abc'}
    def api(endpoint, *args):
        if 'matching-refs' in endpoint:
            return state['refs']
        if '/commits/' in endpoint:
            return {'sha': state['sha']}
        return state['releases']
    monkeypatch.setattr(release, 'api', api)
    calls = []
    monkeypatch.setattr(release.subprocess, 'run', lambda args, **k: calls.append(args))
    return tmp_path, state, calls


def test_new_tag_creates_draft_at_built_commit(draft_setup):
    root, state, calls = draft_setup
    release.prepare_draft(root)
    assert [call[2] for call in calls] == ['create', 'upload', 'upload', 'upload', 'upload']
    assert '--draft' in calls[0] and '--prerelease' in calls[0]
    assert calls[0][calls[0].index('--target') + 1] == 'abc'
    assert '--verify-tag' not in calls[0]


def test_existing_draft_preserves_notes_and_removes_stale_volumes(draft_setup):
    root, state, calls = draft_setup
    state['releases'] = [[{'tag_name': 'v0.1.0-preview', 'draft': True, 'assets': [
        {'name': 'LazuliteStudio-windows-x64-cuda.7z.003'}, {'name': 'manual.txt'}]}]]
    release.prepare_draft(root)
    assert calls[0][2] == 'edit' and '--draft' in calls[0]
    assert '--notes-file' not in calls[0] and '--title' not in calls[0]
    assert calls[1][2] == 'delete-asset' and calls[1][4].endswith('.003')
    assert not any('manual.txt' in call or '--draft=false' in call for call in calls)
    assert sum(call[2] == 'upload' for call in calls) == 4


def test_existing_tag_must_still_match_build(draft_setup):
    root, state, calls = draft_setup
    state['refs'] = [{'ref': 'refs/tags/v0.1.0-preview'}]
    state['sha'] = 'changed'
    with pytest.raises(ValueError, match='标签已移动'):
        release.prepare_draft(root)
    assert not calls


def test_published_release_is_never_changed(draft_setup):
    root, state, calls = draft_setup
    state['releases'] = [[{'tag_name': 'v0.1.0-preview', 'draft': False}]]
    with pytest.raises(ValueError, match='已经发布'):
        release.prepare_draft(root)
    assert not calls


def test_upload_failure_does_not_publish(draft_setup, monkeypatch):
    root, state, calls = draft_setup
    def fail(args, **kwargs):
        calls.append(args)
        if args[2] == 'upload':
            raise RuntimeError('upload failed')
    monkeypatch.setattr(release.subprocess, 'run', fail)
    with pytest.raises(RuntimeError, match='upload failed'):
        release.prepare_draft(root)
    assert '--draft' in calls[0]
    assert not any('--draft=false' in call for call in calls)
