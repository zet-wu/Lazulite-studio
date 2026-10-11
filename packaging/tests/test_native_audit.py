from pathlib import Path
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from native_audit import audit, macho_dependencies


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
        return ('Load command 0\n cmd LC_LOAD_DYLIB\n'
                f' name {dependency} (offset 24)\n'
                'Load command 1\n cmd LC_BUILD_VERSION\n minos 14.0\n sdk 15.0\n')
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


@pytest.mark.parametrize('kind', ['LC_LOAD_DYLIB', 'LC_LOAD_WEAK_DYLIB', 'LC_REEXPORT_DYLIB',
                                 'LC_LAZY_LOAD_DYLIB', 'LC_LOAD_UPWARD_DYLIB'])
def test_macos_self_id_is_not_an_import_but_all_dependency_kinds_are_checked(tmp_path, monkeypatch, kind):
    executable = tmp_path / 'tokenizers.abi3.so'
    executable.write_bytes(b'\xcf\xfa\xed\xfe')
    commands = ('Load command 0\n cmd LC_ID_DYLIB\n'
                ' name @rpath/tokenizers.tokenizers.abi3.so (offset 24)\n'
                f'Load command 1\n cmd {kind}\n'
                ' name /usr/lib/libSystem.B.dylib (offset 24)\n')
    def output(command, **kwargs):
        if command[0] == 'lipo':
            return 'arm64'
        if '-L' in command:
            return f'{executable}:\n\t@rpath/tokenizers.tokenizers.abi3.so (compatibility version 0.0.0)\n'
        return f'{executable}:\n' + commands
    monkeypatch.setattr('native_audit.subprocess.check_output', output)
    assert audit(tmp_path, 'macos-arm64')['binaries'][0]['imports'] == ['/usr/lib/libSystem.B.dylib']
    commands = commands.replace('/usr/lib/libSystem.B.dylib', '@rpath/missing.dylib')
    with pytest.raises(ValueError, match='缺失'):
        audit(tmp_path, 'macos-arm64')
    commands = commands.replace('@rpath/missing.dylib', '@rpath/tokenizers.tokenizers.abi3.so')
    with pytest.raises(ValueError, match='缺失'):
        audit(tmp_path, 'macos-arm64')


@pytest.mark.parametrize('commands', ['garbage', 'Load command 0\n name missing-kind\n',
                                     'Load command 0\n cmd LC_LOAD_DYLIB\n name malformed\n'])
def test_macos_rejects_malformed_commands(commands):
    with pytest.raises(ValueError, match='无法解析'):
        macho_dependencies(commands)


def test_windows_reports_all_missing_runtime_dependencies(tmp_path, monkeypatch):
    from types import SimpleNamespace
    for name in ('first.exe', 'second.pyd'):
        (tmp_path / name).write_bytes(b'fixture')
    system = tmp_path / 'System32'
    system.mkdir()
    # A runtime preinstalled on the host must not satisfy the portable package.
    (system / 'msvcp140.dll').write_bytes(b'host')
    monkeypatch.setenv('SystemRoot', str(tmp_path))
    monkeypatch.setitem(sys.modules, 'pefile', SimpleNamespace(PE=lambda path, **k: SimpleNamespace(
        FILE_HEADER=SimpleNamespace(Machine=0x8664), close=lambda: None,
        parse_data_directories=lambda **k: None,
        DIRECTORY_ENTRY_IMPORT=[SimpleNamespace(dll=b'msvcp140.dll')]
        if str(path).endswith(('.exe', '.pyd')) else [])))
    # Keep the simulated host System32 outside the audited distribution.
    package = tmp_path / 'package'
    package.mkdir()
    for name in ('first.exe', 'second.pyd'):
        (tmp_path / name).rename(package / name)
    with pytest.raises(ValueError) as error:
        audit(package, 'windows-x64-cpu')
    assert 'first.exe' in str(error.value) and 'second.pyd' in str(error.value)
    (package / 'msvcp140.dll').write_bytes(b'bundled')
    assert len(audit(package, 'windows-x64-cpu')['binaries']) == 3
