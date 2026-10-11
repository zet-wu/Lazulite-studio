"""Exercise a prepared distribution with its own Python and production dist.

--python is a development harness override, never evidence of a native package.
"""
import argparse
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time
import urllib.request
import urllib.error


def launcher_command(launcher):
    return [str(launcher), '--no-browser']


def smoke(root, python=None, console_event=0):
    root = Path(root).resolve()
    python = Path(python).absolute() if python else root / ('runtime/python/python.exe' if os.name == 'nt' else 'runtime/python/bin/python3')
    log = root / 'smoke.log'
    command = [str(python), '-E', '-s', '-X', 'utf8', '-m', 'server.portable', '--root', str(root), '--no-browser']
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    flags = {'creationflags': subprocess.CREATE_NEW_CONSOLE} if os.name == 'nt' else {'start_new_session': True}
    launcher = root / ('start.exe' if os.name == 'nt' else 'start.command')
    if launcher.is_file():
        command = launcher_command(launcher)
    with log.open('w', encoding='utf-8') as output:
        process = subprocess.Popen(command, cwd=root / 'app', stdout=output, stderr=subprocess.STDOUT, **flags)
        try:
            for _ in range(160):
                if process.poll() is not None: raise RuntimeError(log.read_text(encoding='utf-8'))
                try:
                    identity = json.loads((root / 'data/runtime/identity.json').read_text(encoding='utf-8'))
                    origin = f'http://127.0.0.1:{identity["port"]}'
                    with opener.open(origin + '/api/v1/runtime', timeout=.5) as response:
                        assert json.load(response)['nonce'] == identity['nonce']
                    break
                except (OSError, ValueError): time.sleep(.25)
            else: raise RuntimeError('readiness timeout')
            with opener.open(origin + '/projects') as response: assert b'<html' in response.read()
            with opener.open(origin + '/api/v1/session') as response: assert json.load(response)['mode'] == 'local'
            for path in ('/missing.js', '/api/v1/absent', '/data/settings.json'):
                try: opener.open(origin + path); raise AssertionError(path)
                except urllib.error.HTTPError as error: assert error.code == 404
            wrong = urllib.request.Request(origin + '/api/v1/projects', data=b'{"name":"forbidden"}', headers={'Content-Type':'application/json','Origin':'https://evil.test'})
            try: opener.open(wrong); raise AssertionError('external origin allowed')
            except urllib.error.HTTPError as error: assert error.code == 403
            duplicate_command = launcher_command(launcher) if launcher.is_file() else command
            duplicate = subprocess.run(duplicate_command, cwd=root if launcher.is_file() else root / 'app', capture_output=True, text=True, encoding='utf-8', timeout=30)
            assert duplicate.returncode == 0, duplicate.stderr
            with opener.open(origin + '/api/v1/runtime') as response: assert json.load(response)['nonce'] == identity['nonce']
            print(json.dumps({'ready':True,'session':'local','static':True,'api_404':True,'origin_rejected':True,'duplicate_same_instance':True,'runtime_override':str(python)}))
        finally:
            if process.poll() is None:
                if os.name == 'nt':
                    subprocess.run([sys.executable, str(Path(__file__).with_name('windows_console.py')),
                                    str(process.pid), str(console_event)], check=True, timeout=10,
                                   creationflags=subprocess.CREATE_NO_WINDOW)
                else:
                    process.send_signal(signal.SIGINT)
                try: process.wait(timeout=20)
                except subprocess.TimeoutExpired: process.kill(); process.wait(); raise RuntimeError('shutdown timeout')
        assert process.returncode == 0, (process.returncode, log.read_text(encoding='utf-8'))
        assert not any(word in log.read_text(encoding='utf-8') for word in ('Traceback', 'KeyboardInterrupt', 'CancelledError', 'Terminate batch job'))
        print(f'graceful shutdown completed (console event {console_event} on Windows, SIGINT on POSIX)')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--python', type=Path)
    args = parser.parse_args()
    smoke(args.root, args.python)
    if os.name == 'nt':
        smoke(args.root, args.python, console_event=1)
