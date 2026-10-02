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
    asset = client.post('/api/v1/assets', files={'file': ('song.wav', wav_bytes())}, headers=headers).json()
    projects = [client.post('/api/v1/projects', json={'name': name, 'source_asset_id': asset['id']}, headers=headers).json()['id'] for name in ('first', 'second')]
    return client, headers, asset, projects, Database(tmp_path / 'studio.sqlite3')


def test_delete_project_removes_records_files_keeps_shared_asset(tmp_path):
    client, headers, asset, (pid, other), db = setup_project(tmp_path)
    with db.transaction() as c:
        revision = c.execute('SELECT current_revision FROM projects WHERE id=?', (pid,)).fetchone()[0]
        output = tmp_path / 'exports' / 'finished.m4a'; output.parent.mkdir(exist_ok=True); output.write_bytes(b'output')
        c.execute("INSERT INTO jobs(id,project_id,kind,status,request_json,result_json,created_at,updated_at) VALUES(?,?,'publish','succeeded','{}',?,'now','now')", ('j', pid, json.dumps({'output_path': str(output)})))
        c.execute("INSERT INTO job_events VALUES('j',1,'state',NULL,NULL,NULL,NULL,0,'now')")
        c.execute("INSERT INTO job_idempotency VALUES(?,'key','hash','j')", (pid,))
        c.execute("INSERT INTO reading_dictionary VALUES('dict',?,'a','b','now')", (pid,))
        c.execute('INSERT INTO review_versions VALUES(?,1)', (pid,))
    assert client.delete(f'/api/v1/projects/{pid}', headers=headers).status_code == 200
    assert client.get(f'/api/v1/projects/{pid}/document').status_code == 404
    assert client.get(f'/api/v1/projects/{other}/audio').status_code == 200
    assert not output.exists() and not (tmp_path / 'revisions' / f'{revision}.ttml').exists()
    assert not (tmp_path / 'revisions' / f'{pid}.draft.json').exists()
    with db.connect() as c:
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
        if calls == 2: raise OSError('disk refused')
        return original(path, target)
    monkeypatch.setattr(Path, 'rename', fail_second)
    with pytest.raises(OSError): delete_project(db, tmp_path, pid)
    assert client.get(f'/api/v1/projects/{pid}/lyrics').status_code == 200
    assert (tmp_path / 'revisions' / f'{pid}.draft.json').exists()
