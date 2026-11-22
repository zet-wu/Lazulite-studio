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
from urllib.parse import quote

from archive import digest, download, extract, package
from native_audit import remove_unused_host_rpaths
from resolve import ROOT, TARGETS, check_build_host


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


def validate_frontend_dist(source, destination):
    """Copy built frontend assets and verify no external URLs are referenced."""
    shutil.copytree(source, destination)
    (destination / 'mockServiceWorker.js').unlink(missing_ok=True)
    for path in destination.rglob('*'):
        if path.suffix in ('.html', '.css'):
            content = path.read_text(encoding='utf-8')
            if re.search(r'''(?:src|href)\s*=\s*["'](?:https?:)?//|(?:url\(|@import\s+)["']?(?:https?:)?//''', content):
                raise ValueError(f'前端启动资源引用外部地址：{path}')


def build_frontend():
    pnpm = shutil.which('pnpm')
    if not pnpm:
        raise RuntimeError('需要 pnpm')
    run([pnpm, '--dir', 'frontend', 'install', '--frozen-lockfile'])
    env = dict(os.environ, VITE_ENABLE_MOCKS='false')
    run([pnpm, '--dir', 'frontend', 'build'], env=env)
    return pnpm, ROOT / 'frontend/dist'


def collect_frontend_licenses(destination, pnpm):
    """Collect production frontend package licenses and sanitized dependency metadata."""
    destination.mkdir(parents=True, exist_ok=True)
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
            return {key: without_host_paths(item) for key, item in value.items() if key != 'path'}
        if isinstance(value, list):
            return [without_host_paths(item) for item in value]
        return value

    write_json(destination / 'frontend-dependencies.json', without_host_paths(collected))
    if not seen:
        raise RuntimeError('无法收集前端生产依赖许可')


def prepare_frontend(output):
    """Build frontend dist and collect licenses once for reuse across packaging targets."""
    output = Path(output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    pnpm, dist_source = build_frontend()
    validate_frontend_dist(dist_source, output / 'dist')
    collect_frontend_licenses(output / 'licenses', pnpm)


def ffmpeg(root, spec, downloads, work, cache_dir=None):
    dest = root / 'runtime/ffmpeg'
    dest.mkdir(parents=True)
    licenses_dir = root / 'licenses/ffmpeg'
    names = ('ffmpeg.exe', 'ffprobe.exe') if os.name == 'nt' else ('ffmpeg', 'ffprobe')
    if cache_dir is not None:
        cache_dir = Path(cache_dir)
        spec_file = cache_dir / 'spec.json'
        cached_licenses = cache_dir / 'licenses'
        if (spec_file.is_file() and json.loads(spec_file.read_text(encoding='utf-8')) == spec
                and cached_licenses.is_dir()
                and all((cache_dir / 'bin' / name).is_file() for name in names)):
            for name in names:
                target = dest / name
                shutil.copy2(cache_dir / 'bin' / name, target)
                if os.name != 'nt':
                    target.chmod(0o755)
            shutil.copytree(cached_licenses, licenses_dir)
            return
    source = download(spec['source'], downloads / ('ffmpeg.zip' if os.name == 'nt' else 'ffmpeg.tar.xz'), spec['sha256'], spec.get('size'))
    unpacked = work / 'ffmpeg-source'
    extract(source, unpacked)
    if os.name == 'nt':
        for name in names:
            matches = list(unpacked.rglob(name))
            if len(matches) != 1:
                raise ValueError(f'FFmpeg 归档没有唯一的 {name}')
            shutil.copy2(matches[0], dest / name)
    else:
        source_root = next(unpacked.glob('ffmpeg-*'))
        run(['sh', 'configure', *spec['configure'], '--disable-x86asm', '--cc=clang'], cwd=source_root)
        run(['make', '-j', str(min(os.cpu_count() or 2, 4))], cwd=source_root)
        for name in names:
            shutil.copy2(source_root / name, dest / name)
    licenses_dir.mkdir(parents=True)
    for path in unpacked.rglob('*'):
        if path.is_file() and (path.name.lower().startswith(('license', 'copying')) or path.name == 'README.txt'):
            destination = licenses_dir / path.relative_to(unpacked)
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, destination)
    shutil.rmtree(unpacked)
    if cache_dir is not None:
        if cache_dir.exists():
            shutil.rmtree(cache_dir)
        (cache_dir / 'bin').mkdir(parents=True)
        for name in names:
            shutil.copy2(dest / name, cache_dir / 'bin' / name)
        shutil.copytree(licenses_dir, cache_dir / 'licenses')
        write_json(cache_dir / 'spec.json', spec)


def python_site_packages(root):
    windows_site = root / 'runtime/python/Lib/site-packages'
    if windows_site.is_dir():
        return windows_site
    matches = sorted((root / 'runtime/python/lib').glob('python*/site-packages'))
    if len(matches) == 1 and matches[0].is_dir():
        return matches[0]
    raise FileNotFoundError(f'无法定位 Python site-packages：{root / "runtime/python"}')


def collect_python_licenses(root, destination):
    """Copy METADATA and license notices from installed dist-info directories."""
    site = python_site_packages(root)
    dist_infos = sorted(p for p in site.glob('*.dist-info') if p.is_dir())
    if not dist_infos:
        raise RuntimeError(f'无法在 {site} 找到已安装 Python 包元数据')
    for dist_info in dist_infos:
        for item in dist_info.rglob('*'):
            if not item.is_file():
                continue
            rel = item.relative_to(dist_info)
            lower = rel.as_posix().lower()
            if lower == 'metadata' or any(word in lower for word in ('license', 'copying', 'notice')):
                target = destination / 'python' / dist_info.name / rel
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(item, target)


def licenses(root, *, pnpm=None, frontend_licenses=None):
    destination = root / 'licenses'
    destination.mkdir(exist_ok=True)
    shutil.copytree(ROOT / 'server/vendor', destination / 'server-vendor',
                    ignore=shutil.ignore_patterns('*.py', '*.pyc', '__pycache__', '*.gz', '*.ocd2'))
    for name in ('LICENSE', 'THIRD_PARTY_LICENSES'):
        shutil.copy2(ROOT / 'vendor/Lazulite' / name, destination / ('Lazulite-' + name))
    if (ROOT / 'LICENSE').exists():
        shutil.copy2(ROOT / 'LICENSE', destination / 'Studio-LICENSE')
    else:
        (destination / 'Studio-NOTICE.txt').write_text('Studio 源码仓库未声明独立许可证；本文件不授予额外权利。\n', encoding='utf-8')
    collect_python_licenses(root, destination)
    if frontend_licenses is not None:
        frontend_licenses = Path(frontend_licenses)
        shutil.copytree(frontend_licenses / 'frontend', destination / 'frontend')
        shutil.copy2(frontend_licenses / 'frontend-dependencies.json', destination / 'frontend-dependencies.json')
    else:
        collect_frontend_licenses(destination, pnpm)


def remove_foreign_installer_templates(root):
    """Do not ship installer launcher templates for other Windows architectures.

    These are package data used to generate new console scripts, not runtime
    dependencies. Keep the x64 templates and all installed application scripts.
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


def model_downloads(root, tag, repository, models=None):
    if not tag.strip() or tag == 'latest' or not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', repository):
        raise ValueError('需要明确的模型资源 Release 标签和 owner/repository')
    if models is None:
        models = json.loads((ROOT / 'packaging/models.json').read_text(encoding='utf-8'))
    base = f'https://github.com/{repository}/releases/download/{quote(tag, safe="")}'
    align_names = (models['nextfire']['directory'], models['mms_fa']['directory'])
    vocal_name = models['bs_karaoke']['directory']
    write_json(root / 'model-downloads.json', {
        'release_tag': tag, 'repository': repository,
        'models': {name: f'{base}/{name}.zip' for name in align_names},
        'vocal_models': {vocal_name: f'{base}/{vocal_name}.zip'}})
    for module in ('download_models.py', 'download_align_models.py', 'download_vocal_models.py'):
        shutil.copy2(ROOT / 'packaging' / module, root / module)
    for category in ('align', 'vocal'):
        entry = f'download-{category}-models.' + ('cmd' if os.name == 'nt' else 'command')
        shutil.copy2(ROOT / 'packaging/launchers' / entry, root / entry)
        if os.name != 'nt':
            (root / entry).chmod(0o755)
    (root / 'models').mkdir()


def build(target, output, model_release_tag, model_repository, *, frontend_dist=None, frontend_licenses=None, ffmpeg_cache=None):
    runtime = json.loads((ROOT / 'packaging/runtime-manifest.json').read_text())
    models = json.loads((ROOT / 'packaging/models.json').read_text())
    check_build_host(target)
    if (frontend_dist is None) != (frontend_licenses is None):
        raise ValueError('--frontend-dist 和 --frontend-licenses 必须同时指定')
    if frontend_dist is not None:
        frontend_dist = Path(frontend_dist).resolve()
        frontend_licenses = Path(frontend_licenses).resolve()
        if not (frontend_dist / 'index.html').is_file():
            raise ValueError(f'预构建前端目录缺少 index.html：{frontend_dist}')
        if not (frontend_licenses / 'frontend').is_dir() or not (frontend_licenses / 'frontend-dependencies.json').is_file():
            raise ValueError(f'预构建前端许可目录不完整：{frontend_licenses}')
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
    if frontend_dist is not None:
        pnpm = None
        validate_frontend_dist(frontend_dist, root / 'app/frontend/dist')
    else:
        pnpm, dist_source = build_frontend()
        validate_frontend_dist(dist_source, root / 'app/frontend/dist')
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
    ffmpeg(root, spec['ffmpeg'], downloads, work, cache_dir=ffmpeg_cache)
    model_downloads(root, model_release_tag, model_repository, models=models)
    for family in ('demucs',):
        for item in models[family]['files']:
            destination = root / 'vocal-models' / family / item['name']
            destination.parent.mkdir(parents=True, exist_ok=True)
            if item['name'] == 'htdemucs.yaml':
                run([python, '-I', '-c', 'import demucs,pathlib,shutil,sys; shutil.copyfile(pathlib.Path(demucs.__file__).parent/"remote/htdemucs.yaml",sys.argv[1])', destination], cwd=work)
                if (('sha256' in item and digest(destination) != item['sha256'])
                        or ('size' in item and destination.stat().st_size != item['size'])):
                    raise ValueError(f'模型文件摘要或大小不匹配：{item["name"]}')
            else:
                download(item.get('url', models[family].get('source')), destination, item['sha256'], item['size'])
    licenses(root, pnpm=pnpm, frontend_licenses=frontend_licenses)
    shutil.copy2(ROOT / 'packaging/models.json', root / 'licenses/models.json')
    shutil.copy2(ROOT / 'packaging/runtime-manifest.json', root / 'licenses/runtime-sources.json')
    from dictionaries import assemble
    assemble(root, ROOT / 'packaging/dictionaries.json')
    shutil.copy2(dependencies / (target + '.txt'), root / 'licenses/dependencies.txt')
    if os.name == 'nt':
        from windows_launcher import compile_launcher
        compile_launcher(root / 'start.exe', work / 'launcher-build')
    else:
        shutil.copy2(ROOT / 'packaging/launchers/start.command', root / 'start.command')
        (root / 'start.command').chmod(0o755)
    manifest = {'schema':1, 'version':commit[:12], 'studio_commit':commit, 'lazulite_commit':library,
                'target':target, 'database_version':runtime['database_version'], 'python':runtime['python_version'],
                'build_python':platform.python_version(),
                'validation':'assembly only; runtime tests run separately during development',
                'unverified':['minimum Windows/macOS version', 'CUDA/MPS hardware', 'full-song quality',
                              'Gatekeeper/download quarantine', 'interactive terminal close']}
    write_json(root / 'manifest.json', manifest)
    shutil.copy2(ROOT / 'packaging/USAGE.txt', root / 'USAGE.txt')
    if target == 'macos-arm64':
        write_json(diagnostics / 'removed-host-rpaths.json', remove_unused_host_rpaths(root))
    for cache in root.rglob('__pycache__'):
        shutil.rmtree(cache)
    shutil.rmtree(dependencies)
    shutil.rmtree(downloads)
    archives = package(root, artifacts)
    write_json(diagnostics / 'validation.json', {**manifest, 'status':'assembled',
               'checks':['pip check'],
               'runtime_tests':'not run during build',
               'archives':[{'file':p.name, 'size':p.stat().st_size} for p in archives]})
    print('便携包已完成组装与压缩：', artifacts)



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
    parser.add_argument('--prepare-frontend', type=Path)
    parser.add_argument('--target', choices=TARGETS)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--model-release-tag')
    parser.add_argument('--model-repository', default='zet-wu/Lazulite-studio')
    parser.add_argument('--frontend-dist', type=Path)
    parser.add_argument('--frontend-licenses', type=Path)
    parser.add_argument('--ffmpeg-cache', type=Path)
    args = parser.parse_args()
    if args.prepare_frontend is not None:
        frontend_output = args.prepare_frontend.resolve()
        if frontend_output.is_relative_to(ROOT) or frontend_output.exists() and any(frontend_output.iterdir()):
            parser.error('--prepare-frontend 必须为仓库外的空目录')
        prepare_frontend(frontend_output)
        return
    if not args.target or not args.output or not args.model_release_tag:
        parser.error('--target、--output 和 --model-release-tag 为必填参数')
    if (args.frontend_dist is None) != (args.frontend_licenses is None):
        parser.error('--frontend-dist 和 --frontend-licenses 必须同时指定')
    output = args.output.resolve()
    if output.is_relative_to(ROOT) or output.exists() and any(output.iterdir()):
        parser.error('output 必须为仓库外的空目录')
    output.mkdir(parents=True, exist_ok=True)
    kwargs = {}
    if args.frontend_dist is not None:
        kwargs['frontend_dist'] = args.frontend_dist.resolve()
        kwargs['frontend_licenses'] = args.frontend_licenses.resolve()
    if args.ffmpeg_cache is not None:
        kwargs['ffmpeg_cache'] = args.ffmpeg_cache.resolve()
    with (output / 'build.log').open('w', encoding='utf-8') as log:
        with redirect_stdout(Tee(sys.stdout, log)), redirect_stderr(Tee(sys.stderr, log)):
            try:
                build(args.target, output, args.model_release_tag, args.model_repository, **kwargs)
            except Exception:
                traceback.print_exc()
                # Do not leave partial archives after a failed build.
                for path in (output / 'artifacts').glob('*'):
                    path.unlink()
                raise SystemExit(1)


if __name__ == '__main__':
    main()
