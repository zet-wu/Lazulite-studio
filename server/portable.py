"""Single-process portable launcher. Run with the distribution's own Python."""
import argparse
import json
import logging
from logging.handlers import RotatingFileHandler
import os
from pathlib import Path
import socket
import sys
import threading
import time
import urllib.request
import uuid
import webbrowser
from .atomic_file import write_atomic
from .instance_lock import InstanceLock, AlreadyRunning
from .runtime_settings import RuntimeSettings


def handshake(origin, expected):
    try:
        # Ignore host proxy environment, including corporate localhost proxies.
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with opener.open(origin + '/api/v1/runtime', timeout=1) as response:
            value = json.load(response)
        return all(value.get(key) == expected[key] for key in ('nonce', 'library_id', 'data_dir', 'port', 'version'))
    except (OSError, ValueError, KeyError):
        return False


def configure_environment(root, manifest):
    binaries = root / 'runtime' / 'ffmpeg'
    python = root / 'runtime' / 'python'
    suffix = '.exe' if os.name == 'nt' else ''
    for name in ('ffmpeg', 'ffprobe'):
        if not (binaries / (name + suffix)).is_file(): raise RuntimeError(f'缺少包内 {name}，请恢复完整运行时组件')
    os.environ['PATH'] = os.pathsep.join([str(binaries), str(python), os.environ.get('PATH', '')])
    os.environ['PYTHONNOUSERSITE'] = '1'
    os.environ.pop('PYTHONPATH', None)
    for key in ('STUDIO_VOCAL_DEVICE', 'STUDIO_ALIGNMENT_DEVICE', 'PYTORCH_ENABLE_MPS_FALLBACK'):
        os.environ.pop(key, None)
    os.environ['STUDIO_VOCAL_MODEL'] = 'htdemucs'
    os.environ['STUDIO_NEXTFIRE_PATH'] = str(root / 'models' / 'nextfire')
    os.environ['STUDIO_DEMUCS_REPO'] = str(root / 'models' / 'demucs')
    os.environ['HF_HUB_OFFLINE'] = '1'
    os.environ['TRANSFORMERS_OFFLINE'] = '1'
    os.environ['HF_HOME'] = str(root / 'data/runtime/huggingface')
    os.environ['TORCH_HOME'] = str(root / 'data/runtime/torch')


def launch(root, *, no_browser=False):
    root = Path(root).resolve()
    manifest = json.loads((root / 'manifest.json').read_text(encoding='utf-8'))
    if manifest.get('target') not in {'windows-x64-cpu', 'windows-x64-cuda', 'macos-arm64'}:
        raise ValueError('程序包类型无效')
    data = root / 'data'
    try:
        lock = InstanceLock(data).__enter__()
    except AlreadyRunning:
        try:
            identity = json.loads((data / 'runtime/identity.json').read_text(encoding='utf-8'))
            origin = f'http://127.0.0.1:{identity["port"]}'
            if identity['data_dir'] != str(data) or not handshake(origin, identity): raise ValueError()
        except (OSError, ValueError, KeyError):
            raise RuntimeError('数据目录已被占用，但运行身份未就绪或不匹配；请检查原终端')
        if not no_browser: webbrowser.open(origin + '/projects')
        print('已打开正在运行的 Studio：' + origin)
        return
    sock = None
    try:
        preferences = RuntimeSettings(data / 'settings.json')
        value = preferences.read()
        port = int(value['values'].get('port', '15173'))
        sock = socket.socket()
        if os.name == 'nt': sock.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        try: sock.bind(('127.0.0.1', port))
        except OSError as exc: raise RuntimeError(f'固定端口 {port} 已被占用；请关闭原程序或在 data/settings.json 中修改 port') from exc
        configure_environment(root, manifest)
        logs = root / 'logs'; logs.mkdir(exist_ok=True)
        handler = RotatingFileHandler(logs / 'studio.log', maxBytes=5*1024*1024, backupCount=3, encoding='utf-8')
        handler.setFormatter(logging.Formatter('%(asctime)s %(levelname)s %(name)s %(message)s'))
        logging.getLogger().addHandler(handler)
        logging.getLogger().setLevel(logging.INFO)
        origin = f'http://127.0.0.1:{port}'
        identity = {'nonce': uuid.uuid4().hex, 'library_id': value['library_id'], 'data_dir': str(data), 'port': port, 'pid': os.getpid(), 'started_at': time.time(), 'version': manifest['version']}
        from .app import create_app
        from .auth import Settings
        from .local_web import mount_frontend
        app = create_app(data / 'projects', Settings(origin=origin, mode='local'), runtime_settings=preferences,
                         runtime_identity=identity, runtime_manifest=manifest)
        mount_frontend(app, root / 'app/frontend/dist')
        write_atomic(data / 'runtime/identity.json', json.dumps(identity).encode())
        import uvicorn
        server = uvicorn.Server(uvicorn.Config(app, host='127.0.0.1', port=port, workers=1, proxy_headers=False, access_log=False, log_config=None))
        done = threading.Event()
        def ready():
            for _ in range(120):
                if done.wait(.25): return
                if server.started and handshake(origin, identity):
                    if not no_browser: webbrowser.open(origin + '/projects')
                    return
        watcher = threading.Thread(target=ready, daemon=True); watcher.start()
        print(f'Studio {manifest["version"]}\n地址：{origin}\n日志：{logs}\n保留此终端；Ctrl+C 停止服务。', flush=True)
        try: server.run(sockets=[sock])
        finally:
            done.set(); watcher.join(timeout=2)
            handler.close(); logging.getLogger().removeHandler(handler)
    finally:
        if sock: sock.close()
        lock.__exit__()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument('--no-browser', action='store_true')
    parser.add_argument('--new-library-id', action='store_true', help='仅用于复制后的独立资料库；停服后显式重置身份')
    args = parser.parse_args()
    try:
        if args.new_library_id:
            with InstanceLock(args.root / 'data'):
                settings = RuntimeSettings(args.root / 'data/settings.json')
                value = settings.read(); value['library_id'] = uuid.uuid4().hex
                settings._write(value)
            return
        launch(args.root, no_browser=args.no_browser)
    except (OSError, ValueError, RuntimeError) as exc:
        print(f'无法启动 Studio：{exc}', file=sys.stderr, flush=True)
        raise SystemExit(1)


if __name__ == '__main__': main()
