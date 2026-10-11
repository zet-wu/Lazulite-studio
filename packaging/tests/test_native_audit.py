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


@pytest.mark.parametrize('host_path', ['/Users/runner/work/build', '/opt/homebrew/lib'])
def test_macos_ignores_filename_header_but_rejects_host_load_commands(tmp_path, monkeypatch, host_path):
    executable = tmp_path / 'ffmpeg'
    executable.write_bytes(b'\xcf\xfa\xed\xfe')
    commands = 'Load command 0\n cmd LC_BUILD_VERSION\n minos 14.0\n sdk 15.0\n'
    def output(command, **kwargs):
        if command[0] == 'lipo':
            return 'arm64'
        header = f'{host_path}/ffmpeg:\n'
        if '-L' in command:
            return header + '\t/usr/lib/libSystem.B.dylib (compatibility version 1.0.0)\n'
        return header + commands
    monkeypatch.setattr('native_audit.subprocess.check_output', output)
    assert len(audit(tmp_path, 'macos-arm64')['binaries']) == 1
    commands += f'Load command 1\n cmd LC_RPATH\n path {host_path} (offset 12)\n'
    with pytest.raises(ValueError, match='构建机路径'):
        audit(tmp_path, 'macos-arm64')
    commands = 'not load commands\n'
    with pytest.raises(ValueError, match='无法读取'):
        audit(tmp_path, 'macos-arm64')


def test_windows_still_rejects_foreign_executables(tmp_path, monkeypatch):
    from types import SimpleNamespace
    executable = tmp_path / 'unexpected.exe'
    executable.write_bytes(b'fixture')
    closed = []
    monkeypatch.setenv('SystemRoot', str(tmp_path))
    monkeypatch.setitem(sys.modules, 'pefile', SimpleNamespace(PE=lambda *a, **k: SimpleNamespace(
        FILE_HEADER=SimpleNamespace(Machine=0x14c), close=lambda: closed.append(True))))
    with pytest.raises(ValueError, match='非 x64'):
        audit(tmp_path, 'windows-x64-cpu')
    assert closed == [True]
