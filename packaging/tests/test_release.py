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


def test_upload_failure_keeps_release_unpublished(tmp_path, monkeypatch):
    archives(tmp_path)
    monkeypatch.setenv('RELEASE_TAG', 'v0.1.0-rc.1')
    monkeypatch.setenv('RELEASE_COMMIT', 'abc')
    monkeypatch.setattr(release.subprocess, 'check_output', lambda *a, **k: 'abc\n')
    calls = []
    def run(args, **kwargs):
        calls.append(args)
        if args[2] == 'upload':
            raise RuntimeError('upload failed')
    monkeypatch.setattr(release.subprocess, 'run', run)
    with pytest.raises(RuntimeError, match='upload failed'):
        release.publish(tmp_path)
    assert '--draft' in calls[0] and '--prerelease' in calls[0]
    assert not any(call[2] == 'edit' for call in calls)


def test_publish_only_after_all_uploads_and_reject_moved_tag(tmp_path, monkeypatch):
    archives(tmp_path)
    monkeypatch.setenv('RELEASE_TAG', 'v0.1.0-rc.1')
    monkeypatch.setenv('RELEASE_COMMIT', 'abc')
    monkeypatch.setattr(release.subprocess, 'check_output', lambda *a, **k: 'abc\n')
    calls = []
    monkeypatch.setattr(release.subprocess, 'run', lambda args, **k: calls.append(args))
    release.publish(tmp_path)
    assert [call[2] for call in calls] == ['create', 'upload', 'upload', 'upload', 'upload', 'edit']
    assert '--draft=false' in calls[-1] and '--latest=false' in calls[-1]
    calls.clear()
    monkeypatch.setattr(release.subprocess, 'check_output', lambda *a, **k: 'changed\n')
    with pytest.raises(ValueError, match='标签已移动'):
        release.publish(tmp_path)
    assert not calls
