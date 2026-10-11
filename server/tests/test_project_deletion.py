import json
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from server.app import create_app
from server.auth import Settings
from server.db import Database
from server.project_deletion import delete_project
from server.tests.test_api import wav_bytes


def setup_project(tmp_path):
    client = TestClient(create_app(tmp_path, Settings('', True, 'http://studio')))
    headers = {'origin': 'http://studio'}
    asset = client.post('/api/v1/uploads', files={'file': ('song.wav', wav_bytes())}, headers=headers).json()
    projects = [client.post('/api/v1/projects', json={'name': 'first', 'upload_id': asset['id']}, headers=headers).json()['id']]
    second = client.post('/api/v1/uploads', files={'file': ('song.wav', wav_bytes())}, headers=headers).json()
    projects.append(client.post('/api/v1/projects', json={'name': 'second', 'upload_id': second['id']}, headers=headers).json()['id'])
    return client, headers, asset, projects, Database(tmp_path / 'studio.sqlite3')


def test_delete_project_releases_owned_resources_and_preserves_other_project(tmp_path):
    client, headers, asset, (pid, other), db = setup_project(tmp_path)
    with db.transaction() as c:
        revision = c.execute('SELECT current_revision FROM projects WHERE id=?', (pid,)).fetchone()[0]
        output = tmp_path / 'projects' / pid / 'exports' / 'finished.m4a'; output.parent.mkdir(exist_ok=True); output.write_bytes(b'output')
        c.execute("INSERT INTO jobs(id,project_id,kind,status,request_json,result_json,created_at,updated_at) VALUES(?,?,'publish','succeeded','{}',?,'now','now')", ('j', pid, json.dumps({'output_path': str(output)})))
        c.execute("INSERT INTO job_events VALUES('j',1,'state',NULL,NULL,NULL,NULL,0,'now')")
        c.execute("INSERT INTO job_idempotency VALUES(?,'key','hash','j')", (pid,))
        vocal = tmp_path / 'projects' / pid / 'vocals' / 'voice'; vocal.mkdir(parents=True)
        (vocal / 'vocals.wav').write_bytes(b'wav')
        (vocal / 'energy.npy').write_bytes(b'energy')
        proxy = tmp_path / 'projects' / pid / 'cache' / 'vocal-voice.wav'; proxy.parent.mkdir(exist_ok=True); proxy.write_bytes(b'proxy')
        peaks = tmp_path / 'projects' / pid / 'cache' / 'vocal-voice.peaks-v1'; peaks.mkdir(); (peaks / 'l0.peaks').write_bytes(b'peaks')
        c.execute('INSERT INTO vocal_results VALUES(?,?,?,?,?,?)', ('voice',pid,asset['id'],'ready',db.paths.store(vocal),'{}'))
    assert client.delete(f'/api/v1/projects/{pid}', headers=headers).status_code == 200
    assert not list(vocal.glob('*')) and not proxy.exists() and not list(peaks.glob('*'))
    assert client.get(f'/api/v1/projects/{pid}/document').status_code == 404
    assert client.get(f'/api/v1/projects/{other}/audio').status_code == 200
    assert not output.exists() and not (tmp_path / 'projects' / pid / 'revisions' / f'{revision}.json').exists()
    assert not (tmp_path / 'projects' / pid / 'revisions' / 'current.draft.json').exists()
    with db.connect() as c:
        assert c.execute('SELECT count(*) FROM vocal_results').fetchone()[0] == 0
        assert c.execute('SELECT count(*) FROM jobs').fetchone()[0] == 0
        assert c.execute('SELECT count(*) FROM job_events').fetchone()[0] == 0
        assert c.execute('SELECT count(*) FROM assets').fetchone()[0] == 1
    assert client.delete(f'/api/v1/projects/{pid}', headers=headers).status_code == 404


@pytest.mark.parametrize('status', ['queued', 'running', 'cancel_requested'])
def test_delete_blocks_nonterminal_worker(tmp_path, status):
    client, headers, asset, (pid, _), db = setup_project(tmp_path)
    with db.transaction() as c:
        c.execute("INSERT INTO jobs(id,project_id,kind,status,request_json,created_at,updated_at) VALUES('j',?,'publish',?,'{}','now','now')", (pid, status))
    response = client.delete(f'/api/v1/projects/{pid}', headers=headers)
    assert response.status_code == 409
    assert client.get(f'/api/v1/projects/{pid}').status_code == 200


def test_delete_file_failure_restores_project(tmp_path, monkeypatch):
    client, headers, asset, (pid, _), db = setup_project(tmp_path)
    from pathlib import Path
    original = Path.rename
    calls = 0
    def fail_second(path, target):
        nonlocal calls
        calls += 1
        if calls == 1: raise OSError('disk refused')
        return original(path, target)
    monkeypatch.setattr(Path, 'rename', fail_second)
    with pytest.raises(OSError): delete_project(db, tmp_path, pid)
    assert client.get(f'/api/v1/projects/{pid}/lyrics').status_code == 200
    assert (tmp_path / 'projects' / pid / 'revisions' / 'current.draft.json').exists()
