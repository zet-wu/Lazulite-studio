"""Exercise a prepared distribution with its own Python and production dist.

--python is a development harness override, never evidence of a native package.
"""
import argparse
import json
import os
from pathlib import Path
import signal
import subprocess
import time
import urllib.request
import urllib.error


def smoke(root, python=None):
    root = Path(root).resolve()
    python = Path(python).absolute() if python else root / ('runtime/python/python.exe' if os.name == 'nt' else 'runtime/python/bin/python3')
    log = root / 'smoke.log'
    command = [str(python), '-E', '-s', '-m', 'server.portable', '--root', str(root), '--no-browser']
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with log.open('w') as output:
        process = subprocess.Popen(command, cwd=root / 'app', stdout=output, stderr=subprocess.STDOUT)
        try:
            for _ in range(160):
                if process.poll() is not None: raise RuntimeError(log.read_text())
                try:
                    identity = json.loads((root / 'data/runtime/identity.json').read_text())
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
            duplicate = subprocess.run(command, cwd=root / 'app', capture_output=True, text=True, timeout=30)
            assert duplicate.returncode == 0, duplicate.stderr
            with opener.open(origin + '/api/v1/runtime') as response: assert json.load(response)['nonce'] == identity['nonce']
            print(json.dumps({'ready':True,'session':'local','static':True,'api_404':True,'origin_rejected':True,'duplicate_same_instance':True,'runtime_override':str(python)}))
        finally:
            if process.poll() is None:
                process.send_signal(signal.SIGINT)
                try: process.wait(timeout=20)
                except subprocess.TimeoutExpired: process.kill(); process.wait(); raise RuntimeError('shutdown timeout')
        assert process.returncode in (0, -signal.SIGINT), process.returncode
        print('Ctrl+C shutdown completed')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--python', type=Path)
    args = parser.parse_args()
    smoke(args.root, args.python)
