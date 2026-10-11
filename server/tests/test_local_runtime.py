import json
from pathlib import Path
import pytest
from fastapi.testclient import TestClient
from server.app import create_app
from server.auth import Settings
from server.local_web import mount_frontend
from server.instance_lock import InstanceLock, AlreadyRunning

ORIGIN = 'http://127.0.0.1:15173'


def test_local_session_host_origin_and_static(tmp_path):
    app = create_app(tmp_path / 'data', Settings(origin=ORIGIN, mode='local'))
    dist = tmp_path / 'dist'; dist.mkdir()
    (dist / 'index.html').write_text('<html>production</html>')
    (dist / 'main.js').write_text('/* asset */')
    mount_frontend(app, dist)
    with TestClient(app, base_url=ORIGIN) as client:
        session = client.get('/api/v1/session').json()
        assert session['authenticated'] and session['mode'] == 'local'
        assert client.get('/projects/p/edit').text == '<html>production</html>'
        assert client.get('/main.js').status_code == 200
        for path in ['/missing.js', '/api/missing', '/api', '/server/app.py', '/data/settings.json']:
            assert client.get(path).status_code == 404
        for headers in [{'Host':'evil.test'}, {'Host':'127.0.0.1:15174'}, {'Origin':'https://evil.test'}, {'Host':'evil.test','X-Forwarded-Host':'127.0.0.1:15173'}]:
            assert client.get('/api/v1/session', headers=headers).status_code == 403
        for origin in [None, 'null', 'http://localhost:15173', 'https://evil.test']:
            headers = {'Origin': origin} if origin else {}
            assert client.post('/api/v1/projects', json={'name':'bad'}, headers=headers).status_code == 403
            assert client.patch('/api/v1/settings', json={'changes':{}}, headers=headers).status_code == 403
            assert client.delete('/api/v1/projects/x', headers=headers).status_code == 403
        headers = {'Origin':ORIGIN}
        assert client.post('/api/v1/projects', json={'name':'local'}, headers=headers).status_code == 200
        settings = client.get('/api/v1/settings')
        assert client.patch('/api/v1/settings', json={'changes':{'lazulite-editor-theme':'dark'}}, headers={**headers, 'If-Match':settings.headers['etag']}).status_code == 200
        assert client.patch('/api/v1/settings', json={'changes':{}}, headers={**headers, 'If-Match':settings.headers['etag']}).status_code == 409


@pytest.mark.parametrize('origin', ['http://0.0.0.0:15173', 'https://127.0.0.1:15173', 'http://evil.test', 'http://localhost:15173'])
def test_local_config_rejects_remote_or_ambiguous_origin(origin):
    with pytest.raises(ValueError): Settings(origin=origin, mode='local')


def test_os_lock_ignores_stale_metadata_and_prevents_other_ports(tmp_path):
    with InstanceLock(tmp_path):
        (tmp_path / 'runtime/identity.json').write_text(json.dumps({'pid':0,'port':15174}))
        with pytest.raises(AlreadyRunning):
            with InstanceLock(tmp_path): pass
    with InstanceLock(tmp_path): pass
