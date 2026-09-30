"""Run the authenticated local API and Vite; no dependency installation."""
from pathlib import Path
import os
import shutil
import signal
import socket
import subprocess
import sys
import threading
import time

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
    python = ROOT / 'server' / '.venv' / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python')
    pnpm = shutil.which('pnpm')
    if not python.is_file() or not pnpm or not (ROOT / 'frontend/node_modules/vite').exists():
        sys.exit('缺少 server/.venv、pnpm 或 frontend 依赖；请按开发说明安装后重试。')
    if not os.environ.get('STUDIO_PASSWORD') and os.environ.get('STUDIO_TRUSTED_GATEWAY') != 'true':
        sys.exit('请设置 STUDIO_PASSWORD；启动入口不会关闭认证。')
    for port in (8000, 5173):
        with socket.socket() as sock:
            try:
                sock.bind(('127.0.0.1', port))
            except OSError:
                sys.exit(f'端口 {port} 已被占用，请先关闭占用进程。')
    env = {**os.environ, 'STUDIO_ORIGIN': 'http://127.0.0.1:5173', 'STUDIO_API_TARGET': 'http://127.0.0.1:8000'}
    commands = [('api', [str(python), '-m', 'uvicorn', '--factory', 'server.app:create_app', '--host', '127.0.0.1', '--port', '8000', '--reload'], ROOT),
                ('vite', [pnpm, 'dev', '--host', '127.0.0.1', '--port', '5173', '--strictPort'], ROOT / 'frontend')]
    processes = []
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
            threading.Thread(target=log, args=(name, p), daemon=True).start()
        print('打开 http://127.0.0.1:5173；Ctrl+C 关闭两个服务。', flush=True)
        while all(p.poll() is None for p in processes):
            time.sleep(.2)
        return 1
    except KeyboardInterrupt:
        return 0
    finally:
        for p in reversed(processes):
            stop(p)


if __name__ == '__main__':
    sys.exit(main())
