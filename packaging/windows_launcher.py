"""Compile the small console launcher with the native build host's MSVC."""
import os
from pathlib import Path
import subprocess


def compile_launcher(output, work):
    output, work = Path(output).resolve(), Path(work).resolve()
    work.mkdir(parents=True, exist_ok=True)
    vswhere = Path(os.environ['ProgramFiles(x86)']) / 'Microsoft Visual Studio/Installer/vswhere.exe'
    installation = subprocess.check_output([
        str(vswhere), '-latest', '-products', '*', '-requires',
        'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-property', 'installationPath'
    ], text=True).strip()
    if not installation:
        raise RuntimeError('构建 start.exe 需要 MSVC x64 构建工具')
    vcvars = Path(installation) / 'VC/Auxiliary/Build/vcvars64.bat'
    source = Path(__file__).parent / 'launchers/start.cpp'
    # Invoke a fixed script filename from cwd, avoiding cmd /c absolute-path parsing.
    script = work / 'compile-launcher.cmd'
    script.write_text(
        f'@echo off\nchcp 65001 >nul\ncall "{vcvars}" >nul\nif errorlevel 1 exit /b 1\n'
        f'cl /nologo /std:c++17 /O2 /MT /EHsc /utf-8 /W4 /WX "{source}" /Fe:"{output}" '
        '/link /SUBSYSTEM:CONSOLE /DYNAMICBASE /NXCOMPAT\n', encoding='utf-8')
    subprocess.run([os.environ.get('COMSPEC', 'cmd.exe'), '/d', '/c', script.name], cwd=work, check=True)
