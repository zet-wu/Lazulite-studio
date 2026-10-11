from pathlib import Path
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from native_audit import audit


def test_macos_records_declared_minimum_and_rejects_missing_dependency(tmp_path, monkeypatch):
    executable = tmp_path / 'runtime/python/bin/python3'
    executable.parent.mkdir(parents=True)
    executable.write_bytes(b'\xcf\xfa\xed\xfe')
    dependency = '@rpath/missing.dylib'
    def output(command, **kwargs):
        if command[0] == 'lipo':
            return 'arm64'
        if '-L' in command:
            return f'{executable}:\n\t{dependency} (compatibility version 1.0.0)\n'
        return 'Load command 1\n cmd LC_BUILD_VERSION\n minos 14.0\n sdk 15.0\n'
    monkeypatch.setattr('native_audit.subprocess.check_output', output)
    with pytest.raises(ValueError, match='缺失'):
        audit(tmp_path, 'macos-arm64')
    dependency = '/usr/lib/libSystem.B.dylib'
    assert audit(tmp_path, 'macos-arm64')['declared_macos_minimum'] == '14.0'
    dependency = '/opt/homebrew/lib/host.dylib'
    with pytest.raises(ValueError, match='包外'):
        audit(tmp_path, 'macos-arm64')
