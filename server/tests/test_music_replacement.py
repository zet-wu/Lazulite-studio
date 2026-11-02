import json
import shutil
from pathlib import Path
import pytest
from server.tests.test_project_resources import client_for, upload, binding, HEADERS
from server.db import Database
from server.music_replacement import recover_music_replacements


def test_reimport_same_bytes_clears_acoustics_and_preserves_lyrics_and_idempotency(tmp_path):
    with client_for(tmp_path) as client:
        token=upload(client)
        pid=client.post('/api/v1/projects',json={'name':'song','upload_id':token},headers=HEADERS).json()['id']
        url=f'/api/v1/projects/{pid}'
        before=client.get(url+'/document').json()
        before['document']['acoustics']['segments']=[{'id':'manual','beginMs':0,'endMs':20000}]
        saved=client.put(url+'/document',json=before,headers={**HEADERS,'if-match':before['revision']})
        assert saved.status_code==200
        original=client.get(url+'/document').json()['document']
        old_file=tmp_path/'projects'/pid/'cache'/'old-product';old_file.write_bytes(b'old')
        new_token=upload(client);request=binding(client,pid,new_token)
        result=client.post(url+'/music',json=request,headers=HEADERS)
        assert result.status_code==200,result.text
        assert result.json()['asset']['id']!=token
        after=client.get(url+'/document').json()
        assert after['document']=={**original,'acoustics':{'analysisId':None,'segments':[]}}
        assert not old_file.exists()
        assert client.post(url+'/music',json=request,headers=HEADERS).json()==result.json()
        assert client.get(url+'/document').json()['revision']==after['revision']
        assert not list((tmp_path/'.replacing').iterdir())
        with Database(tmp_path/'studio.sqlite3').connect() as conn:
            assert not conn.execute('SELECT 1 FROM assets WHERE id=?',(token,)).fetchone()
            assert conn.execute('SELECT count(*) FROM revisions WHERE project_id=?',(pid,)).fetchone()[0]==1


def test_busy_and_database_failure_preserve_old_source(tmp_path):
    with client_for(tmp_path) as client:
        token=upload(client);pid=client.post('/api/v1/projects',json={'name':'song','upload_id':token},headers=HEADERS).json()['id']
        db=Database(tmp_path/'studio.sqlite3');new=upload(client);request=binding(client,pid,new)
        with db.transaction() as conn:
            conn.execute("INSERT INTO jobs(id,project_id,kind,status,request_json,created_at,updated_at) VALUES('busy',?,'vocal','running','{}','now','now')",(pid,))
        assert client.post(f'/api/v1/projects/{pid}/music',json=request,headers=HEADERS).json()['code']=='project_busy'
        with db.transaction() as conn:
            conn.execute("DELETE FROM jobs WHERE id='busy'")
            conn.execute("CREATE TRIGGER fail_switch BEFORE UPDATE OF source_asset_id ON projects BEGIN SELECT RAISE(ABORT,'switch failure'); END")
        with pytest.raises(Exception,match='switch failure'):client.post(f'/api/v1/projects/{pid}/music',json=request,headers=HEADERS)
        assert client.get(f'/api/v1/projects/{pid}').json()['asset']['id']==token
        assert client.get(f'/api/v1/projects/{pid}/document').json()['revision']==request['revision']
        assert (tmp_path/'projects'/pid/'source'/'original').is_file()


def test_restart_rolls_back_uncommitted_directory_swap(tmp_path):
    with client_for(tmp_path) as client:
        token=upload(client);pid=client.post('/api/v1/projects',json={'name':'song','upload_id':token},headers=HEADERS).json()['id']
    directory=tmp_path/'projects'/pid;journal=tmp_path/'.replacing'/pid;journal.mkdir(parents=True)
    (journal/'intent.json').write_text(json.dumps({'asset_id':'new'}))
    directory.rename(journal/'previous');directory.mkdir();(directory/'incomplete').write_text('new')
    with client_for(tmp_path) as client:
        assert client.get(f'/api/v1/projects/{pid}/document').status_code==200
        assert client.get(f'/api/v1/projects/{pid}').json()['asset']['id']==token
        assert not (directory/'incomplete').exists() and not journal.exists()


def test_committed_cleanup_failure_is_visible_and_retry_does_not_advance_revision(tmp_path,monkeypatch):
    import server.music_replacement as replacement
    with client_for(tmp_path) as client:
        token=upload(client);pid=client.post('/api/v1/projects',json={'name':'song','upload_id':token},headers=HEADERS).json()['id']
        new=upload(client);request=binding(client,pid,new)
        original=replacement.shutil.rmtree
        def fail_cleanup(path,*args,**kwargs):
            if Path(path)==tmp_path/'.replacing'/pid:raise PermissionError('open file')
            return original(path,*args,**kwargs)
        monkeypatch.setattr(replacement.shutil,'rmtree',fail_cleanup)
        first=client.post(f'/api/v1/projects/{pid}/music',json=request,headers=HEADERS)
        assert first.status_code==200,first.text
        assert first.json()['cleanup_pending'] is True
        assert client.get(f'/api/v1/projects/{pid}/audio?source={token}').status_code==409
        monkeypatch.setattr(replacement.shutil,'rmtree',original)
        retry=client.post(f'/api/v1/projects/{pid}/music',json=request,headers=HEADERS)
        assert retry.json()['revision']==first.json()['revision']
        assert retry.json()['cleanup_pending'] is False
        assert not (tmp_path/'.replacing'/pid).exists()


def test_completed_journal_is_collected_on_restart(tmp_path):
    with client_for(tmp_path) as client:
        token=upload(client);pid=client.post('/api/v1/projects',json={'name':'song','upload_id':token},headers=HEADERS).json()['id']
    journal=tmp_path/'.replacing'/pid;journal.mkdir(parents=True)
    (journal/'intent.json').write_text(json.dumps({'asset_id':token}));(journal/'previous').mkdir();(journal/'previous'/'obsolete').write_text('old')
    with client_for(tmp_path) as client:
        assert client.get(f'/api/v1/projects/{pid}/audio').status_code==200
        assert not journal.exists()
