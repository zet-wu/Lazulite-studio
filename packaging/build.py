"""Native portable distribution builder. Run on the target OS/architecture."""
import argparse
from contextlib import redirect_stderr, redirect_stdout
import json
import hashlib
import os
from pathlib import Path
import platform
import re
import shutil
import subprocess
import sys
import traceback

from archive import digest, download, extract, package
from native_audit import audit
from resolve import ROOT, TARGETS, check_source
from verify_models import verify


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
                removed.append({'path': path.relative_to(root).as_posix(), 'sha256': digest(path)})
                path.unlink()
    return removed


def build(target, output):
    runtime = json.loads((ROOT / 'packaging/runtime-manifest.json').read_text())
    models = json.loads((ROOT / 'packaging/models.json').read_text())
    check_build_host(target, runtime)
    commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    if subprocess.check_output(['git', 'status', '--porcelain', '--untracked-files=normal'], cwd=ROOT, text=True).strip():
        raise RuntimeError('发布输入必须为干净检出；输出目录请放在仓库外')
    library = check_source()
    work, artifacts = output / 'work', output / 'artifacts'
    work.mkdir(); artifacts.mkdir()
    downloads = work / 'downloads'
    dependencies = work / 'dependencies'
    # Run as a subprocess to capture pip diagnostics in the build log.
    run([sys.executable, ROOT / 'packaging/resolve.py', '--target', target, '--output', dependencies])
    diagnostics = output / 'diagnostics'
    diagnostics.mkdir()
    for path in dependencies.glob('*'):
        if path.is_file():
            shutil.copy2(path, diagnostics / path.name)
    shutil.rmtree(dependencies / 'verification')
    root = work / f'LazuliteStudio-{target}-{commit[:12]}'
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
         '--require-hashes', '--no-compile', '-r', dependencies / (target + '.txt')], cwd=work, env=env)
    run([python, '-I', '-m', 'pip', 'check'], cwd=work, env=env)
    if target.startswith('windows'):
        write_json(diagnostics / 'removed-installer-templates.json', remove_foreign_installer_templates(root))
    ffmpeg(root, spec['ffmpeg'], downloads, work)
    for family in ('demucs', 'nextfire'):
        for item in models[family]['files']:
            destination = root / 'models' / family / item['name']
            destination.parent.mkdir(parents=True, exist_ok=True)
            if item['name'] == 'htdemucs.yaml':
                run([python, '-I', '-c', 'import demucs,pathlib,shutil,sys; shutil.copyfile(pathlib.Path(demucs.__file__).parent/"remote/htdemucs.yaml",sys.argv[1])', destination], cwd=work)
            else:
                download(item.get('url', models[family].get('source')), destination, item['sha256'], item['size'])
    verify(root / 'models', models)
    licenses(root, dependencies, pnpm)
    shutil.copy2(ROOT / 'packaging/models.json', root / 'licenses/models.json')
    shutil.copy2(ROOT / 'packaging/runtime-manifest.json', root / 'licenses/runtime-sources.json')
    shutil.copy2(dependencies / (target + '.txt'), root / 'licenses/dependencies.txt')
    launcher = '启动.bat' if os.name == 'nt' else '启动.command'
    shutil.copy2(ROOT / 'packaging/launchers' / launcher, root / launcher)
    if os.name != 'nt':
        (root / launcher).chmod(0o755)
    manifest = {'schema':1, 'version':commit[:12], 'studio_commit':commit, 'lazulite_commit':library,
                'target':target, 'database_version':5, 'runtime_set_id':hashlib.sha256((json.dumps(spec, sort_keys=True) + digest(dependencies / (target + '.txt'))).encode()).hexdigest(),
                'model_set_id':digest(ROOT / 'packaging/models.json'), 'python':runtime['python_version'],
                'build_python':platform.python_version(),
                'validation':'preview; see adjacent validation.json for this artifact run',
                'unverified':['minimum Windows/macOS version', 'CUDA/MPS hardware', 'full-song quality',
                              'Gatekeeper/download quarantine', 'interactive terminal close']}
    write_json(root / 'manifest.json', manifest)
    (root / '使用说明.txt').write_text(
        f'Lazulite Studio 预览版 {commit[:12]}（{target}）\n'
        '将本版本全部 ZIP 解压到同一位置，保持同名顶层目录合并。不要直接在压缩包内运行。\n'
        f'双击 {launcher}；保留终端窗口，浏览器会在服务就绪后打开。Ctrl+C 停止服务。\n'
        '新建项目、导入音频、编辑保存并重开；然后试用分离、日语对齐，核对设置中的实际设备。\n'
        '无需另装 Python、Node、FFmpeg、CUDA Toolkit 或在线下载模型；在线歌词搜索仍需要网络。\n'
        'CUDA 版需要兼容 NVIDIA 驱动；GPU 不可用时可选择 CPU，计算失败不会自动重跑。\n'
        'Mac 版未签名、未公证；首次打开可能受系统安全策略限制，请核对来源并按系统提示处理。\n'
        'data 保存项目和设置，logs 保存日志。停服后可搬移整个目录。更新前备份 data，勿覆盖用户数据。\n'
        '旧 v4 数据库不自动升级，请从旧版导出工程或使用显式迁移工具。\n'
        '本包包含非商业许可的 NextFire 权重，请查阅 licenses/models.json 和模型说明。\n'
        '最低系统版本、实际 GPU、整曲质量与关闭终端行为仍需真机反馈，详见下载旁的 validation.json。\n'
        '反馈请注明系统 build、设备、驱动、内存、包版本和复现步骤；日志由你自行发送，不自动上传。\n', encoding='utf-8')
    write_json(diagnostics / 'native-audit.json', audit(root, target))
    files = [{'path':p.relative_to(root).as_posix(), 'size':p.stat().st_size, 'sha256':digest(p)}
             for p in sorted(root.rglob('*')) if p.is_file()]
    write_json(root / 'files.json', files)
    shutil.rmtree(dependencies)
    shutil.rmtree(downloads)
    archives = package(root, artifacts)
    name = root.name
    shutil.rmtree(root)
    relocated = work / '解包 测试 (portable) & relocation'
    for path in archives:
        extract(path, relocated)
    root = relocated / name
    for item in files:
        path = root / item['path']
        if digest(path) != item['sha256']:
            raise ValueError(f'解包身份不符：{item["path"]}')
    # Omit all build tools and ambient user caches from the runtime process environment.
    env = {k:v for k,v in os.environ.items() if not k.startswith(('PYTHON', 'HF_', 'TRANSFORMERS_', 'TORCH_', 'STUDIO_'))}
    env['PATH'] = str(root / 'runtime/ffmpeg') + os.pathsep + (str(Path(os.environ['SystemRoot']) / 'System32') if os.name == 'nt' else '/usr/bin:/bin')
    env.update(PYTHONNOUSERSITE='1', PYTHONUTF8='1', HF_HUB_OFFLINE='1', TRANSFORMERS_OFFLINE='1',
               HF_HOME=str(work / 'empty-hf'), TORCH_HOME=str(work / 'empty-torch'))
    python = runtime_python(root)
    run([python, '-E', '-s', ROOT / 'packaging/runtime_smoke.py', '--root', root, '--target', target], cwd=root / 'app', env=env)
    if os.name == 'nt':
        powershell = Path(os.environ['SystemRoot']) / 'System32/WindowsPowerShell/v1.0/powershell.exe'
        offline = [powershell, '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
                   ROOT / 'packaging/model_smoke_windows.ps1', '-Python', python,
                   '-Script', ROOT / 'packaging/model_smoke.py', '-Models', root / 'models']
    else:
        offline = ['/usr/bin/sandbox-exec', '-p', '(version 1)(allow default)(deny network*)',
                   python, '-E', '-s', ROOT / 'packaging/model_smoke.py', '--models', root / 'models', '--os-isolated']
    run(offline, cwd=root / 'app', env=env)
    run([sys.executable, ROOT / 'packaging/smoke.py', '--root', root], cwd=work, env=env)
    shutil.copy2(root / 'smoke.log', diagnostics / 'launcher.log')
    write_json(artifacts / 'validation.json', {**manifest, 'status':'native-relocated-cpu-smoke-passed',
               'checks':['pip check', 'native architecture/import audit', 'archive file hashes',
                         'Japanese/Chinese/media', 'local Demucs/NextFire CPU with OS network isolation and empty caches',
                         'local service/static/auth/duplicate launcher/graceful shutdown'],
               'network_scope':'Windows per-program outbound firewall rule / macOS sandbox-exec deny network; plus Python socket hook',
               'archives':[{'file':p.name, 'size':p.stat().st_size, 'sha256':digest(p)} for p in archives]})
    shutil.copy2(root / '使用说明.txt', artifacts / '使用说明.txt')
    (artifacts / 'SHA256SUMS').write_text(''.join(f'{digest(p)}  {p.name}\n' for p in archives), encoding='utf-8')
    print('完整便携包已通过原生解包冒烟：', artifacts)
    shutil.rmtree(relocated)


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
                # Archives created before failed smoke must never look publishable.
                for path in (output / 'artifacts').glob('*.zip'):
                    path.unlink()
                raise SystemExit(1)


if __name__ == '__main__':
    main()
