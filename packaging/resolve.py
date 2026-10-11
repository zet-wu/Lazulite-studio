"""Resolve and build a complete wheelhouse on the target native host.

Run from the repository root in a fresh CPython 3.12 build environment. Outputs
are installed and checked once in the final bundled runtime.
"""
import argparse
import json
from pathlib import Path
import platform
import subprocess
import sys
import zipfile
from email.parser import BytesParser

ROOT = Path(__file__).resolve().parents[1]
TARGETS = {'windows-x64-cpu': ('Windows', 'AMD64'), 'windows-x64-cuda': ('Windows', 'AMD64'), 'macos-arm64': ('Darwin', 'arm64')}


def check_source():
    source = ROOT / 'vendor/Lazulite'
    if not (source / 'pyproject.toml').is_file(): raise RuntimeError('子模块未初始化，请运行 git submodule update --init --recursive')
    expected = subprocess.check_output(['git', 'ls-files', '--stage', 'vendor/Lazulite'], cwd=ROOT, text=True).split()[1]
    actual = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=source, text=True).strip()
    dirty = subprocess.check_output(['git', 'status', '--porcelain'], cwd=source, text=True).strip()
    if actual != expected or dirty: raise RuntimeError('子模块提交不匹配或含未提交修改，拒绝构建')
    return actual


def resolve(target, output):
    if (platform.system(), platform.machine()) != TARGETS[target] or sys.version_info[:2] != (3, 12):
        raise RuntimeError(f'{target} 必须在对应原生架构 CPython 3.12 环境解析，当前为 {platform.system()}/{platform.machine()}/{platform.python_version()}')
    commit = check_source()
    output = Path(output).resolve()
    if output.exists() and any(output.iterdir()): raise RuntimeError('输出目录必须为空，避免混入旧轮子')
    wheels = output / 'wheelhouse'; wheels.mkdir(parents=True)
    def pip(*args): subprocess.run([sys.executable, '-m', 'pip', *args], cwd=ROOT, check=True)
    # Build-time tools are separate from the shipped environment.
    pip('install', 'pip==25.3', 'setuptools==80.9.0', 'wheel==0.45.1', 'build==1.3.0')
    pip('wheel', '--no-build-isolation', '--wheel-dir', str(wheels), '-r', str(ROOT / 'packaging/requirements' / (target + '.in')))
    artifacts, locked = [], []
    for wheel in sorted(wheels.glob('*.whl')):
        with zipfile.ZipFile(wheel) as archive:
            metadata = BytesParser().parsebytes(archive.read(next(n for n in archive.namelist() if n.endswith('.dist-info/METADATA'))))
        locked.append(f'{metadata["Name"]}=={metadata["Version"]}')
        artifacts.append({'filename': wheel.name, 'name': metadata['Name'], 'version': metadata['Version'], 'size': wheel.stat().st_size})
    lock = output / (target + '.txt'); lock.write_text('\n'.join(locked) + '\n')
    (output / 'resolution.json').write_text(json.dumps({'target':target, 'platform':platform.platform(), 'python':platform.python_version(), 'lazulite_commit':commit, 'status':'wheelhouse-built-runtime-check-pending', 'artifacts':artifacts}, indent=2) + '\n')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--target', choices=TARGETS, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    resolve(args.target, args.output)
