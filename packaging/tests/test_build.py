from pathlib import Path
import json
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import build


def test_failed_smoke_does_not_leave_publishable_archives(tmp_path, monkeypatch):
    output = tmp_path / 'build'
    def fail(target, output):
        artifacts = output / 'artifacts'
        artifacts.mkdir()
        (artifacts / 'unverified.zip').write_bytes(b'not verified')
        raise RuntimeError('simulated smoke failure')
    monkeypatch.setattr(build, 'build', fail)
    monkeypatch.setattr(sys, 'argv', ['build.py', '--target', 'windows-x64-cpu', '--output', str(output)])
    with pytest.raises(SystemExit) as error:
        build.main()
    assert error.value.code == 1
    assert not list((output / 'artifacts').glob('*.zip'))
    assert 'simulated smoke failure' in (output / 'build.log').read_text()


def test_build_rejects_wrong_native_platform_before_downloads(tmp_path, monkeypatch):
    monkeypatch.setattr(build.platform, 'system', lambda: 'Linux')
    with pytest.raises(RuntimeError, match='原生架构'):
        build.build('windows-x64-cpu', tmp_path)
    assert list(tmp_path.iterdir()) == []
