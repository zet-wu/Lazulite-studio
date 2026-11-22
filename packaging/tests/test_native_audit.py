from pathlib import Path
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from native_audit import remove_unused_host_rpaths


def test_remove_only_unused_host_rpaths_and_resign(tmp_path, monkeypatch):
    binary = tmp_path / '_fblas.so'
    binary.write_bytes(b'fixture')
    commands = ('Load command 0\n cmd LC_LOAD_DYLIB\n name /usr/lib/libSystem.B.dylib (offset 24)\n'
                'Load command 1\n cmd LC_RPATH\n path @loader_path (offset 12)\n'
                'Load command 2\n cmd LC_RPATH\n path /opt/homebrew/Cellar/gcc/lib (offset 12)\n')
    monkeypatch.setattr('native_audit.subprocess.check_output', lambda *a, **k: commands)
    calls = []
    monkeypatch.setattr('native_audit.subprocess.run', lambda args, **k: calls.append(args))
    changes = remove_unused_host_rpaths(tmp_path)
    assert changes[0]['removed_rpaths'] == ['/opt/homebrew/Cellar/gcc/lib']
    assert {tuple(call) for call in calls} >= {
        ('install_name_tool', '-delete_rpath', '/opt/homebrew/Cellar/gcc/lib', str(binary)),
        ('codesign', '--force', '--sign', '-', str(binary)),
        ('codesign', '--verify', '--strict', str(binary)),
    }
    calls.clear()
    commands = commands.replace('/usr/lib/libSystem.B.dylib', '@rpath/librequired.dylib')
    with pytest.raises(ValueError, match='不能自动删除'):
        remove_unused_host_rpaths(tmp_path)
    assert calls == []


def test_remove_unused_host_rpaths_skips_safe_rpaths(tmp_path, monkeypatch):
    binary = tmp_path / 'safe.dylib'
    binary.write_bytes(b'fixture')
    commands = ('Load command 0\n cmd LC_LOAD_DYLIB\n name /usr/lib/libSystem.B.dylib (offset 24)\n'
                'Load command 1\n cmd LC_RPATH\n path @loader_path (offset 12)\n')
    monkeypatch.setattr('native_audit.subprocess.check_output', lambda *a, **k: commands)
    calls = []
    monkeypatch.setattr('native_audit.subprocess.run', lambda args, **k: calls.append(args))
    assert remove_unused_host_rpaths(tmp_path) == []
    assert calls == []
