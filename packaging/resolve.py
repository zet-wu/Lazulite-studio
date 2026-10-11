"""Resolve, build and verify a complete wheelhouse on the target native host.

Run from the repository root in a fresh CPython 3.12 build environment. Outputs
are candidates until the resulting runtime passes model and native smoke tests.
"""
import argparse
import hashlib
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
    pip('install', '--dry-run', '--ignore-installed', '--report', str(output / 'sources.json'), '-r', str(ROOT / 'packaging/requirements' / (target + '.in')))
    pip('wheel', '--no-build-isolation', '--wheel-dir', str(wheels), '-r', str(ROOT / 'packaging/requirements' / (target + '.in')))
    artifacts, locked = [], []
    for wheel in sorted(wheels.glob('*.whl')):
        digest = hashlib.file_digest(wheel.open('rb'), 'sha256').hexdigest()
        with zipfile.ZipFile(wheel) as archive:
            metadata = BytesParser().parsebytes(archive.read(next(n for n in archive.namelist() if n.endswith('.dist-info/METADATA'))))
        locked.append(f'{metadata["Name"]}=={metadata["Version"]} --hash=sha256:{digest}')
        artifacts.append({'filename': wheel.name, 'name': metadata['Name'], 'version': metadata['Version'], 'sha256': digest, 'size': wheel.stat().st_size})
    lock = output / (target + '.txt'); lock.write_text('\n'.join(locked) + '\n')
    # An independent venv proves dependency closure without build tools installed.
    import venv
    env = output / 'verification'; venv.EnvBuilder(with_pip=True).create(env)
    python = env / ('Scripts/python.exe' if platform.system() == 'Windows' else 'bin/python')
    subprocess.run([str(python), '-m', 'pip', 'install', '--no-index', '--find-links', str(wheels), '--require-hashes', '-r', str(lock)], check=True)
    subprocess.run([str(python), '-m', 'pip', 'check'], check=True)
    subprocess.run([str(python), '-c', 'import fastapi,uvicorn,numpy,scipy,torch,torchaudio,demucs,transformers,soundfile,sudachipy,opencc,lazulite; print(torch.__version__, torch.version.cuda, lazulite.__file__)'], cwd=output, check=True)
    (output / 'resolution.json').write_text(json.dumps({'target':target, 'platform':platform.platform(), 'python':platform.python_version(), 'lazulite_commit':commit, 'status':'native-install-and-import-verified-model-smoke-pending', 'artifacts':artifacts}, indent=2) + '\n')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--target', choices=TARGETS, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    resolve(args.target, args.output)
