import os
from pathlib import Path
import subprocess
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from smoke import launcher_command


@pytest.mark.skipif(os.name != 'nt', reason='Requires native cmd.exe batch parsing')
def test_batch_launcher_in_relocated_directory(tmp_path):
    root = tmp_path / '解包 测试 (portable) & relocation'
    root.mkdir()
    launcher = root / '启动.bat'
    launcher.write_text('@echo off\nchcp 65001 >nul\necho "%~dp0"\necho %~1\n', encoding='utf-8')
    result = subprocess.run(launcher_command(launcher), cwd=root,
                            capture_output=True, encoding='utf-8', timeout=10)
    assert result.returncode == 0, result.stderr
    assert result.stdout.splitlines() == ['"' + str(root) + '\\"', '--no-browser']
