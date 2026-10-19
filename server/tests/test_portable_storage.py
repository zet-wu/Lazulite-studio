import json
import shutil
import sqlite3
from pathlib import Path
import pytest
from fastapi.testclient import TestClient
from server.app import create_app
from server.auth import Settings
from server.db import Database
from server.revisions import RevisionStore
from server.runtime_settings import RuntimeSettings, SettingsConflict
from server.storage_paths import StoragePaths
from server.migrate_storage import migrate
from server.tests.test_vocals import setup, wait

HEADERS = {'origin': 'http://studio'}


def test_move_complete_library(tmp_path):
    source = tmp_path / 'original'
    source.mkdir()
    client, db = setup(source)
    with client:
        job = client.post('/api/v1/projects/p/jobs/vocal', json={'params': {'asset_id': 'p'}}, headers=HEADERS).json()
        assert wait(client, job['id'])['status'] == 'succeeded'
        first, snapshot = RevisionStore(db, source / 'projects').read('p')
        snapshot['acoustics']['analysisId'] = job['id']
        second = RevisionStore(db, source / 'projects').create('p', snapshot, first)['id']
        identity = client.get('/api/v1/session').json()['library_id']
        # A successful immutable export participates in startup collection too.
        output = source / 'projects/p/exports/finished.m4a'
        output.parent.mkdir(); output.write_bytes(b'export fixture')
        with db.transaction() as c:
            c.execute("INSERT INTO jobs(id,project_id,kind,status,request_json,result_json,created_at,updated_at) VALUES('export','p','publish','succeeded','{}',?,'0','0')", (json.dumps({'output_path': db.paths.store(output), 'report': {'passed': True}}),))
    destination = tmp_path / '中文 空格 (搬移) &'
    shutil.move(source, destination)
    with TestClient(create_app(destination, Settings(None, True, 'http://studio'))) as moved:
        assert moved.get('/api/v1/session').json()['library_id'] == identity
        assert moved.get('/api/v1/projects/p/document').json()['revision'] == second
        assert moved.get(f'/api/v1/projects/p/vocals/{job["id"]}/energy?start_ms=0&end_ms=1000').status_code == 200
        assert moved.get(f'/api/v1/projects/p/vocals/{job["id"]}/file', headers={'Range': 'bytes=0-9'}).status_code == 206
        assert moved.get('/api/v1/projects/p/exports/export/download').content == b'export fixture'
        assert moved.get('/api/v1/projects/p/archive').status_code == 200


@pytest.mark.parametrize('value', ['/tmp/outside', '../outside', 'a/../../b', 'C:/test', 'C:test', r'a\b', 'a/./b'])
def test_reject_unsafe_paths(tmp_path, value):
    with pytest.raises(ValueError): StoragePaths(tmp_path).resolve(value)


def test_symlink_escape(tmp_path):
    (tmp_path / 'link').symlink_to(tmp_path.parent, target_is_directory=True)
    with pytest.raises(ValueError): StoragePaths(tmp_path).resolve('link/outside')


def test_old_database_requires_explicit_copy_conversion(tmp_path):
    source = tmp_path / 'v4'
    with TestClient(create_app(source, Settings(None, True, 'http://studio'))) as client:
        pid = client.post('/api/v1/projects', json={'name': '保存的项目'}, headers=HEADERS).json()['id']
    with sqlite3.connect(source / 'studio.sqlite3') as conn:
        conn.execute('UPDATE revisions SET project_path=? || project_path', (str(source) + '/',))
        conn.execute('PRAGMA user_version=4')
    before = (source / 'studio.sqlite3').read_bytes()
    with pytest.raises(RuntimeError, match='v5'): Database(source / 'studio.sqlite3')
    assert migrate(source)['dry_run']
    destination = tmp_path / 'v5'
    assert not migrate(source, destination)['dry_run']
    assert (source / 'studio.sqlite3').read_bytes() == before
    with TestClient(create_app(destination, Settings(None, True, 'http://studio'))) as client:
        assert client.get(f'/api/v1/projects/{pid}/document').status_code == 200


def test_preferences_conflicts_import_and_delete(tmp_path):
    store = RuntimeSettings(tmp_path / 'settings.json')
    store.patch({'lazulite-editor-theme': 'dark'}, 0)
    with pytest.raises(SettingsConflict): store.patch({'studio.playback-rate': '1.5'}, 0)
    store.patch({'studio.playback-rate': '1.5'}, 1)
    store.patch({'lazulite-editor-theme': 'light'}, 2, import_legacy=True)
    assert store.read()['values']['lazulite-editor-theme'] == 'dark'
    store.patch({'studio:workspace-mode:project:p': 'sync', 'studio:workspace-mode:project:q': 'edit'}, 3)
    store.delete_project('p')
    assert 'studio:workspace-mode:project:p' not in store.read()['values']
    assert store.read()['values']['studio:workspace-mode:project:q'] == 'edit'
