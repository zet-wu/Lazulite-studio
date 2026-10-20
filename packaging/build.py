"""Native portable distribution builder. Run on the target OS/architecture."""
import argparse
from contextlib import redirect_stderr, redirect_stdout
import json
import filecmp
import os
from pathlib import Path
import platform
import re
import shutil
import subprocess
import sys
import traceback

from archive import download, extract, package
from native_audit import audit, remove_unused_host_rpaths
from resolve import ROOT, TARGETS


def run(args, *, cwd=ROOT, env=None):
    print('+', ' '.join(map(str, args)), flush=True)
    # Pipe through Python so build.log contains tool failures as well as stage messages.
    with subprocess.Popen(list(map(str, args)), cwd=cwd, env=env, stdout=subprocess.PIPE,
                          stderr=subprocess.STDOUT, text=True, encoding='utf-8', errors='replace') as process:
        for line in process.stdout:
            print(line, end='', flush=True)
        if process.wait():
            raise subprocess.CalledProcessError(process.returncode, args)


def write_json(path, value):
    Path(path).write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def runtime_python(root):
    return root / ('runtime/python/python.exe' if os.name == 'nt' else 'runtime/python/bin/python3')


def frontend(output, runtime):
    node = subprocess.check_output(['node', '--version'], text=True).strip().removeprefix('v')
    pnpm = shutil.which('pnpm')
    if node != runtime['node'] or not pnpm:
        raise RuntimeError(f'需要 Node {runtime["node"]} 和 pnpm {runtime["pnpm"]}')
    version = subprocess.check_output([pnpm, '--version'], text=True).strip()
    if version != runtime['pnpm']:
        raise RuntimeError(f'pnpm 版本不匹配：{version}')
    run([pnpm, '--dir', 'frontend', 'install', '--frozen-lockfile'])
    env = dict(os.environ, VITE_ENABLE_MOCKS='false')
    run([pnpm, '--dir', 'frontend', 'build'], env=env)
    dist = output / 'app/frontend/dist'
    shutil.copytree(ROOT / 'frontend/dist', dist)
    (dist / 'mockServiceWorker.js').unlink(missing_ok=True)
    for path in dist.rglob('*'):
        if path.suffix in ('.html', '.css'):
            content = path.read_text(encoding='utf-8')
            if re.search(r'''(?:src|href)\s*=\s*["'](?:https?:)?//|(?:url\(|@import\s+)["']?(?:https?:)?//''', content):
                raise ValueError(f'前端启动资源引用外部地址：{path}')
    return pnpm


def ffmpeg(root, spec, downloads, work):
    dest = root / 'runtime/ffmpeg'
    dest.mkdir(parents=True)
    source = download(spec['source'], downloads / ('ffmpeg.zip' if os.name == 'nt' else 'ffmpeg.tar.xz'), spec['sha256'], spec.get('size'))
    unpacked = work / 'ffmpeg-source'
    extract(source, unpacked)
    if os.name == 'nt':
        for name in ('ffmpeg.exe', 'ffprobe.exe'):
            matches = list(unpacked.rglob(name))
            if len(matches) != 1:
                raise ValueError(f'FFmpeg 归档没有唯一的 {name}')
            shutil.copy2(matches[0], dest / name)
    else:
        source_root = next(unpacked.glob('ffmpeg-*'))
        run(['sh', 'configure', *spec['configure'], '--disable-x86asm', '--cc=clang'], cwd=source_root)
        run(['make', '-j', str(min(os.cpu_count() or 2, 4))], cwd=source_root)
        for name in ('ffmpeg', 'ffprobe'):
            shutil.copy2(source_root / name, dest / name)
    licenses = root / 'licenses/ffmpeg'
    licenses.mkdir(parents=True)
    for path in unpacked.rglob('*'):
        if path.is_file() and (path.name.lower().startswith(('license', 'copying')) or path.name == 'README.txt'):
            destination = licenses / path.relative_to(unpacked)
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, destination)
    shutil.rmtree(unpacked)


def licenses(root, dependencies, pnpm):
    destination = root / 'licenses'
    destination.mkdir(exist_ok=True)
    shutil.copytree(ROOT / 'server/vendor', destination / 'server-vendor',
                    ignore=shutil.ignore_patterns('*.py', '*.pyc', '__pycache__', '*.gz'))
    for name in ('LICENSE', 'THIRD_PARTY_LICENSES'):
        shutil.copy2(ROOT / 'vendor/Lazulite' / name, destination / ('Lazulite-' + name))
    if (ROOT / 'LICENSE').exists():
        shutil.copy2(ROOT / 'LICENSE', destination / 'Studio-LICENSE')
    else:
        (destination / 'Studio-NOTICE.txt').write_text('Studio 源码仓库未声明独立许可证；本文件不授予额外权利。\n', encoding='utf-8')
    # Wheel license files remain in installed dist-info directories. Preserve metadata too.
    import zipfile
    for wheel in (dependencies / 'wheelhouse').glob('*.whl'):
        with zipfile.ZipFile(wheel) as archive:
            for item in archive.infolist():
                if item.is_dir():
                    continue
                member = item.filename
                lower = member.lower()
                if '.dist-info/' in lower and (lower.endswith('/metadata') or any(word in lower for word in ('license', 'copying', 'notice'))):
                    target = destination / 'python' / wheel.stem / member
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_bytes(archive.read(member))
    data = subprocess.check_output([pnpm, '--dir', 'frontend', 'list', '--prod', '--depth', 'Infinity', '--json'], cwd=ROOT, text=True)
    seen = set()
    def collect(value):
        if isinstance(value, dict):
            if 'path' in value and 'version' in value:
                path = Path(value['path']).resolve()
                if path not in seen:
                    seen.add(path)
                    folder = destination / 'frontend' / str(len(seen))
                    folder.mkdir(parents=True)
                    for source in path.iterdir():
                        if source.is_file() and (source.name.lower().startswith(('license', 'copying', 'notice')) or source.name == 'package.json'):
                            shutil.copy2(source, folder / source.name)
            for item in value.values():
                collect(item)
        elif isinstance(value, list):
            for item in value:
                collect(item)
    collected = json.loads(data)
    collect(collected)
    def without_host_paths(value):
        if isinstance(value, dict):
            return {key:without_host_paths(item) for key,item in value.items() if key != 'path'}
        if isinstance(value, list):
            return [without_host_paths(item) for item in value]
        return value
    write_json(destination / 'frontend-dependencies.json', without_host_paths(collected))
    if not seen:
        raise RuntimeError('无法收集前端生产依赖许可')


def check_build_host(target, runtime):
    expected = runtime['build_python_version']
    if (platform.system(), platform.machine()) != TARGETS[target] or platform.python_version() != expected:
        raise RuntimeError(f'{target} 需要对应原生架构的构建 Python {expected}')


def remove_foreign_installer_templates(root):
    """Do not ship installer launcher templates for other Windows architectures.

    These are package data used to generate new console scripts, not runtime
    dependencies. Keep the x64 templates and all installed application scripts.
    The native audit still checks every executable remaining in the package.
    """
    site = root / 'runtime/python/Lib/site-packages'
    templates = {
        'setuptools': ('cli.exe', 'gui.exe', 'cli-32.exe', 'gui-32.exe',
                       'cli-arm64.exe', 'gui-arm64.exe'),
        'pip/_vendor/distlib': ('t32.exe', 'w32.exe', 't64-arm.exe', 'w64-arm.exe'),
    }
    removed = []
    for directory, names in templates.items():
        for name in names:
            path = site / directory / name
            if path.is_file():
                removed.append({'path': path.relative_to(root).as_posix()})
                path.unlink()
    return removed


def deploy_windows_runtime(root):
    """Keep VC++ DLLs beside standalone executables as well as python.exe.

    msvc-runtime installs its pinned DLL set into the Python prefix and Scripts.
    Nested tools such as OpenCC cannot use python.exe's application directory.
    Never source these redistributable DLLs from the build host's System32.
    """
    runtime = root / 'runtime/python'
    source = runtime / 'Scripts'
    prefixes = ('msvcp140', 'vcruntime140', 'concrt140', 'vcomp140', 'vcamp140', 'vccorlib140')
    dlls = {p.name.lower(): p for p in source.glob('*.dll') if p.name.lower().startswith(prefixes)}
    required = {'msvcp140.dll', 'vcruntime140.dll', 'vcruntime140_1.dll'}
    if not required.issubset(dlls):
        raise ValueError(f'缺少锁定的 VC++ 运行库：{sorted(required - dlls.keys())}')
    destinations = {p.parent for p in runtime.rglob('*.exe')} - {runtime, source}
    copied = []
    for directory in sorted(destinations):
        for name, path in sorted(dlls.items()):
            destination = directory / name
            if destination.exists() and not filecmp.cmp(path, destination, shallow=False):
                raise ValueError(f'VC++ 运行库冲突：{destination}')
            shutil.copy2(path, destination)
            copied.append({'path': destination.relative_to(root).as_posix()})
    return copied


def build(target, output):
    runtime = json.loads((ROOT / 'packaging/runtime-manifest.json').read_text())
    models = json.loads((ROOT / 'packaging/models.json').read_text())
    check_build_host(target, runtime)
    commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    if subprocess.check_output(['git', 'status', '--porcelain', '--untracked-files=normal'], cwd=ROOT, text=True).strip():
        raise RuntimeError('发布输入必须为干净检出；输出目录请放在仓库外')
    work, artifacts = output / 'work', output / 'artifacts'
    work.mkdir(); artifacts.mkdir()
    downloads = work / 'downloads'
    dependencies = work / 'dependencies'
    # Run as a subprocess to capture pip diagnostics in the build log.
    run([sys.executable, ROOT / 'packaging/resolve.py', '--target', target, '--output', dependencies])
    library = json.loads((dependencies / 'resolution.json').read_text())['lazulite_commit']
    diagnostics = output / 'diagnostics'
    diagnostics.mkdir()
    for path in dependencies.glob('*'):
        if path.is_file():
            shutil.copy2(path, diagnostics / path.name)
    root = work / f'LazuliteStudio-{target}'
    root.mkdir()
    pnpm = frontend(root, runtime)
    (root / 'app/server').mkdir(parents=True)
    tracked = subprocess.check_output(['git', 'ls-files', '-z', 'server'], cwd=ROOT).decode().split('\0')
    for name in filter(None, tracked):
        path = Path(name)
        if 'tests' in path.parts or path.suffix == '.md' or path.name.startswith(('requirements', 'constraints')):
            continue
        destination = root / 'app' / path
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(ROOT / path, destination)
    spec = runtime['targets'][target]
    archive = download(spec['python']['url'], downloads / 'python.tar.gz', spec['python']['sha256'], spec['python'].get('size'))
    extract(archive, root / 'runtime')
    python = runtime_python(root)
    env = dict(os.environ, PYTHONNOUSERSITE='1', PYTHONUTF8='1')
    env.pop('PYTHONPATH', None)
    run([python, '-I', '-m', 'pip', 'install', '--no-index', '--find-links', dependencies / 'wheelhouse',
         '--no-compile', '-r', dependencies / (target + '.txt')], cwd=work, env=env)
    run([python, '-I', '-m', 'pip', 'check'], cwd=work, env=env)
    if target.startswith('windows'):
        write_json(diagnostics / 'removed-installer-templates.json', remove_foreign_installer_templates(root))
        write_json(diagnostics / 'app-local-vc-runtime.json', deploy_windows_runtime(root))
    ffmpeg(root, spec['ffmpeg'], downloads, work)
    for family in ('demucs', 'nextfire'):
        for item in models[family]['files']:
            destination = root / 'models' / family / item['name']
            destination.parent.mkdir(parents=True, exist_ok=True)
            if item['name'] == 'htdemucs.yaml':
                run([python, '-I', '-c', 'import demucs,pathlib,shutil,sys; shutil.copyfile(pathlib.Path(demucs.__file__).parent/"remote/htdemucs.yaml",sys.argv[1])', destination], cwd=work)
            else:
                download(item.get('url', models[family].get('source')), destination, item['sha256'], item['size'])
    licenses(root, dependencies, pnpm)
    shutil.copy2(ROOT / 'packaging/models.json', root / 'licenses/models.json')
    shutil.copy2(ROOT / 'packaging/runtime-manifest.json', root / 'licenses/runtime-sources.json')
    from dictionaries import assemble
    assemble(root, python, ROOT / 'packaging/dictionaries.json')
    result = subprocess.check_output([python, '-I', str(ROOT / 'packaging/dictionary_smoke.py'), str(root)], cwd=work, env=env, text=True)
    (diagnostics / 'dictionaries.json').write_text(result, encoding='utf-8')
    shutil.copy2(dependencies / (target + '.txt'), root / 'licenses/dependencies.txt')
    if os.name == 'nt':
        from windows_launcher import compile_launcher
        compile_launcher(root / 'start.exe', work / 'launcher-build')
    else:
        shutil.copy2(ROOT / 'packaging/launchers/start.command', root / 'start.command')
        (root / 'start.command').chmod(0o755)
    manifest = {'schema':1, 'version':commit[:12], 'studio_commit':commit, 'lazulite_commit':library,
                'target':target, 'database_version':6, 'python':runtime['python_version'],
                'build_python':platform.python_version(),
                'validation':'preview; see the separate build diagnostics artifact for validation.json',
                'unverified':['minimum Windows/macOS version', 'CUDA/MPS hardware', 'full-song quality',
                              'Gatekeeper/download quarantine', 'interactive terminal close']}
    write_json(root / 'manifest.json', manifest)
    shutil.copy2(ROOT / 'packaging/USAGE.txt', root / 'USAGE.txt')
    if target == 'macos-arm64':
        write_json(diagnostics / 'removed-host-rpaths.json', remove_unused_host_rpaths(root))
    write_json(diagnostics / 'native-audit.json', audit(root, target))
    # Omit all build tools and ambient user caches from the runtime process environment.
    env = {k:v for k,v in os.environ.items() if not k.startswith(('PYTHON', 'HF_', 'TRANSFORMERS_', 'TORCH_', 'STUDIO_'))}
    env['PATH'] = str(root / 'runtime/ffmpeg') + os.pathsep + (str(Path(os.environ['SystemRoot']) / 'System32') if os.name == 'nt' else '/usr/bin:/bin')
    env.update(PYTHONNOUSERSITE='1', PYTHONUTF8='1', HF_HUB_OFFLINE='1', TRANSFORMERS_OFFLINE='1',
               HF_HOME=str(work / 'empty-hf'), TORCH_HOME=str(work / 'empty-torch'))
    python = runtime_python(root)
    run([python, '-E', '-s', '-X', 'utf8', ROOT / 'packaging/runtime_smoke.py', '--root', root, '--target', target], cwd=root / 'app', env=env)
    run([sys.executable, ROOT / 'packaging/smoke.py', '--root', root], cwd=work, env=env)
    shutil.copy2(root / 'smoke.log', diagnostics / 'launcher.log')
    # Smoke runs in the assembled directory before compression; do not ship its data.
    for name in ('data', 'logs'):
        if (root / name).exists():
            shutil.rmtree(root / name)
    (root / 'smoke.log').unlink()
    for cache in root.rglob('__pycache__'):
        shutil.rmtree(cache)
    shutil.rmtree(dependencies)
    shutil.rmtree(downloads)
    archives = package(root, artifacts)
    write_json(diagnostics / 'validation.json', {**manifest, 'status':'assembled-runtime-smoke-passed',
               'checks':['pip check', 'native architecture/import audit',
                         'Japanese/Chinese/media', 'local service/static/graceful shutdown'],
               'archives':[{'file':p.name, 'size':p.stat().st_size} for p in archives]})
    print('便携包已完成组装、启动检查与压缩：', artifacts)



class Tee:
    def __init__(self, *streams):
        self.streams = streams
    def write(self, value):
        for stream in self.streams:
            stream.write(value)
            stream.flush()
    def flush(self):
        for stream in self.streams:
            stream.flush()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--target', required=True, choices=TARGETS)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    output = args.output.resolve()
    if output.is_relative_to(ROOT) or output.exists() and any(output.iterdir()):
        parser.error('output 必须为仓库外的空目录')
    output.mkdir(parents=True, exist_ok=True)
    with (output / 'build.log').open('w', encoding='utf-8') as log:
        with redirect_stdout(Tee(sys.stdout, log)), redirect_stderr(Tee(sys.stderr, log)):
            try:
                build(args.target, output)
            except Exception:
                traceback.print_exc()
                # Do not leave partial archives after a failed build.
                for path in (output / 'artifacts').glob('*'):
                    path.unlink()
                raise SystemExit(1)


if __name__ == '__main__':
    main()
