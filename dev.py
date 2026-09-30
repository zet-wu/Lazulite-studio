"""Run the authenticated local API and Vite; no dependency installation."""
from pathlib import Path
import os
import argparse
import shutil
import signal
import socket
import subprocess
import sys
import threading
import time
import urllib.request
import urllib.error

ROOT = Path(__file__).resolve().parent


def stop(process):
    if os.name == 'nt':
        subprocess.run(['taskkill', '/PID', str(process.pid), '/T', '/F'], capture_output=True)
    else:
        try:
            os.killpg(process.pid, signal.SIGTERM)
        except ProcessLookupError:
            return
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        if os.name != 'nt':
            os.killpg(process.pid, signal.SIGKILL)
        process.wait()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--api-port', type=int, default=8000)
    parser.add_argument('--web-port', type=int, default=5173)
    args = parser.parse_args()
    if not all(1 <= p <= 65535 for p in (args.api_port, args.web_port)) or args.api_port == args.web_port:
        parser.error('两个端口必须不同且位于 1–65535')
    python = ROOT / 'server' / '.venv' / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python')
    pnpm = shutil.which('pnpm')
    if not python.is_file() or not pnpm or not (ROOT / 'frontend/node_modules/vite').exists():
        sys.exit('缺少 server/.venv、pnpm 或 frontend 依赖；请按开发说明安装后重试。')
    if not os.environ.get('STUDIO_PASSWORD') and os.environ.get('STUDIO_TRUSTED_GATEWAY') != 'true':
        sys.exit('请设置 STUDIO_PASSWORD；启动入口不会关闭认证。')
    for port in (args.api_port, args.web_port):
        with socket.socket() as sock:
            # Match POSIX server binding: TIME_WAIT is not a live listener.
            if os.name != 'nt': sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                sock.bind(('127.0.0.1', port))
            except OSError:
                sys.exit(f'端口 {port} 已被占用，请先关闭占用进程。')
    env = {**os.environ, 'STUDIO_ORIGIN': f'http://127.0.0.1:{args.web_port}', 'STUDIO_API_TARGET': f'http://127.0.0.1:{args.api_port}'}
    commands = [('api', [str(python), '-m', 'uvicorn', '--factory', 'server.app:create_app', '--host', '127.0.0.1', '--port', str(args.api_port), '--reload', '--reload-dir', str(ROOT / 'server')], ROOT),
                ('vite', [pnpm, 'dev', '--host', '127.0.0.1', '--port', str(args.web_port), '--strictPort'], ROOT / 'frontend')]
    processes = []
    job = None
    if os.name == 'nt':
        from dev_windows import ProcessJob
        job = ProcessJob()
    def log(name, process):
        for line in process.stdout:
            print(f'[{name}] {line}', end='', flush=True)
    def interrupted(*_):
        raise KeyboardInterrupt
    signal.signal(signal.SIGTERM, interrupted)
    try:
        for name, command, cwd in commands:
            # Windows .cmd launchers need cmd.exe; all arguments here are trusted local paths.
            if os.name == 'nt' and command[0].endswith('.cmd'):
                command = [os.environ.get('COMSPEC', 'cmd.exe'), '/c', *command]
            p = subprocess.Popen(command, cwd=cwd, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                 text=True, encoding='utf-8', errors='replace', start_new_session=os.name != 'nt',
                                 creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == 'nt' else 0)
            processes.append(p)
            if job: job.assign(p)
            threading.Thread(target=log, args=(name, p), daemon=True).start()
        print(f'打开 http://127.0.0.1:{args.web_port}；Ctrl+C 关闭两个服务。', flush=True)
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        def ready(port, path):
            try:
                with opener.open(f'http://127.0.0.1:{port}{path}', timeout=1) as response:
                    return response.status < 500
            except urllib.error.HTTPError as error:
                return error.code < 500
            except (OSError, urllib.error.URLError):
                return False
        started = time.monotonic()
        healthy = False
        failures = 0
        while all(p.poll() is None for p in processes):
            ok = ready(args.api_port, '/api/v1/session') and ready(args.web_port, '/')
            if ok:
                healthy = True
                failures = 0
            elif healthy:
                failures += 1
            if (not healthy and time.monotonic() - started > 20) or failures >= 5:
                print('服务启动失败或持续无响应，正在关闭进程树。', flush=True)
                return 1
            time.sleep(1)
        print('服务进程意外退出，正在关闭另一进程。', flush=True)
        return 1
    except KeyboardInterrupt:
        return 0
    finally:
        if job: job.close()
        for p in reversed(processes):
            stop(p)


if __name__ == '__main__':
    sys.exit(main())
