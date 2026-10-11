from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import json
from pathlib import Path
from fastapi.testclient import TestClient
from server.app import create_app
from server.auth import Settings
from server.db import Database
from server.revisions import RevisionStore
from server.project_document import initial_project
from server.tests.test_api import wav_bytes

HEADERS = {'origin':'http://studio'}

def client_for(root):
    return TestClient(create_app(root, Settings(None, True, 'http://studio')))

def upload(client):
    response = client.post('/api/v1/uploads', files={'file':('music.wav',wav_bytes(),'audio/wav')}, headers=HEADERS)
    assert response.status_code == 200, response.text
    return response.json()['id']

def test_music_optional_upload_does_not_change_revision_lyrics_metadata_or_search(tmp_path):
    with client_for(tmp_path) as client:
        created = client.post('/api/v1/projects', json={'name':'No music'}, headers=HEADERS).json()
        pid = created['id']; assert created['asset'] is None
        url = f'/api/v1/projects/{pid}'
        before = client.get(url+'/document').json()
        snapshot = before['document']; assert 'sourceAssetId' not in snapshot
        snapshot['lyrics']['draftTtml'] = '<tt xmlns="http://www.w3.org/ns/ttml"><body><p begin="10" end="20">超出后来音乐时长的歌词</p></body></tt>'
        saved = client.put(url+'/document', json={**{k:before[k] for k in ('schema_version','project_id','revision')},'document':snapshot}, headers={**HEADERS,'if-match':before['revision']}).json()
        client.put(url+'/search-conditions', json={'title':'manual','artist':'','album':''}, headers=HEADERS)
        for endpoint in ('audio','waveform','pcm?start_ms=0&end_ms=100','packaging'):
            assert client.get(url+'/'+endpoint).status_code in (404,422)
        assert client.post(url+'/jobs/vocal', json={'params':{'asset_id':'missing'}}, headers=HEADERS).status_code == 422
        token = upload(client)
        result = client.post(url+'/music', json={'upload_id':token}, headers=HEADERS)
        assert result.status_code == 200
        assert client.get(url+'/document').json()['revision'] == saved['revision']
        assert client.get(url+'/document').json()['document'] == saved['document']
        assert client.get(url+'/search-conditions').json()['title'] == 'manual'
        assert client.get(url).json()['name'] == 'No music'
        assert client.post(url+'/music', json={'upload_id':token}, headers=HEADERS).status_code == 200
        # A stale lyric snapshot from before upload remains saveable and cannot detach music.
        before['revision'] = saved['revision']; before['document'] = snapshot
        response = client.put(url+'/document', json={k:before[k] for k in ('schema_version','project_id','revision','document')}, headers={**HEADERS,'if-match':saved['revision']})
        assert response.status_code == 200
        assert client.get(url).json()['asset']['id'] == token
        assert not list((tmp_path/'uploads').iterdir())

def test_independent_music_competing_uploads_cancel_delete_and_restart(tmp_path):
    with client_for(tmp_path) as client:
        tokens = [upload(client),upload(client)]
        assert tokens[0] != tokens[1]
        ids = [client.post('/api/v1/projects', json={'name':str(i),'upload_id':token},headers=HEADERS).json()['id'] for i,token in enumerate(tokens)]
        files = [tmp_path/'projects'/pid/'source'/'original' for pid in ids]
        assert all(p.is_file() for p in files) and files[0].stat().st_ino != files[1].stat().st_ino
        empty = client.post('/api/v1/projects',json={'name':'race'},headers=HEADERS).json()['id']
        competing = [upload(client),upload(client)]
        with ThreadPoolExecutor(2) as pool:
            results = list(pool.map(lambda token: client.post(f'/api/v1/projects/{empty}/music',json={'upload_id':token},headers=HEADERS).status_code,competing))
        assert sorted(results) == [200,409]
        cancelled = upload(client)
        assert client.delete('/api/v1/uploads/'+cancelled,headers=HEADERS).status_code == 200
        assert not list((tmp_path/'uploads').iterdir())
        assert client.delete(f'/api/v1/projects/{ids[0]}',headers=HEADERS).status_code == 200
        assert not files[0].parent.parent.exists() and files[1].is_file()
        pending = upload(client)
    with client_for(tmp_path) as client:
        assert not (tmp_path/'uploads'/pending).exists()
        assert client.get(f'/api/v1/projects/{ids[1]}/audio',headers={'range':'bytes=0-15'}).status_code == 206

def test_deleted_target_and_invalid_upload_leave_no_owned_resources(tmp_path):
    with client_for(tmp_path) as client:
        pid = client.post('/api/v1/projects',json={'name':'delete'},headers=HEADERS).json()['id']
        token = upload(client)
        client.delete(f'/api/v1/projects/{pid}',headers=HEADERS)
        assert client.post(f'/api/v1/projects/{pid}/music',json={'upload_id':token},headers=HEADERS).status_code == 404
        assert not (tmp_path/'projects'/pid).exists() and not list((tmp_path/'uploads').iterdir())
        assert client.post('/api/v1/uploads',files={'file':('bad.wav',b'bad')},headers=HEADERS).status_code == 415
        assert not list((tmp_path/'uploads').iterdir())

def test_revision_collection_protects_references_recent_and_current(tmp_path):
    db = Database(tmp_path/'studio.sqlite3');store = RevisionStore(db,tmp_path/'projects')
    with db.transaction() as c: c.execute('INSERT INTO projects VALUES(?,?,?,?,?,?)',('p','p',None,None,'now','now'))
    ids=[];base=None
    for i in range(108):
        base=store.create('p',initial_project(f'<tt xmlns="http://www.w3.org/ns/ttml"><body><p>{i}</p></body></tt>',None),base)['id'];ids.append(base)
    with db.transaction() as c:
        c.execute("UPDATE revisions SET created_at='2000-01-01T00:00:00+00:00'")
        # Make recency deterministic and preserve one old snapshot by age.
        for i,rid in enumerate(ids):c.execute('UPDATE revisions SET created_at=? WHERE id=?',(f'2000-01-01T00:{i//60:02}:{i%60:02}+00:00',rid))
        c.execute('UPDATE revisions SET created_at=? WHERE id=?',(datetime.now(timezone.utc).isoformat(),ids[0]))
        c.execute("INSERT INTO jobs(id,project_id,kind,status,request_json,result_json,created_at,updated_at) VALUES('j','p','alignment','succeeded',?,?,'now','now')",(json.dumps({'revision':ids[1]}),json.dumps({'binding':{'revision':ids[2]}})))
    store.collect('p')
    with db.connect() as c: kept={row[0] for row in c.execute('SELECT id FROM revisions')}
    assert set(ids[:3]+[ids[-1]]) <= kept
    assert ids[4] not in kept and ids[5] not in kept
    assert len(kept) == 103 # 100 unreferenced + two references + current (recent is among 100)
    store.recover()
    assert store.read('p')[0] == ids[-1]

def test_create_failure_restores_upload_for_retry_and_attach_failure_cleans(tmp_path):
    import pytest
    with client_for(tmp_path) as client:
        token=upload(client);db=Database(tmp_path/'studio.sqlite3')
        with db.transaction() as c:
            c.execute("CREATE TRIGGER reject_create BEFORE INSERT ON projects BEGIN SELECT RAISE(ABORT,'fail'); END")
        with pytest.raises(Exception, match='fail'):
            client.post('/api/v1/projects',json={'name':'retry','upload_id':token},headers=HEADERS)
        assert (tmp_path/'uploads'/token/'source'/'original').is_file()
        assert not list((tmp_path/'projects').iterdir())
        with db.transaction() as c:c.execute('DROP TRIGGER reject_create')
        made=client.post('/api/v1/projects',json={'name':'retry','upload_id':token},headers=HEADERS)
        assert made.status_code==200
        empty=client.post('/api/v1/projects',json={'name':'empty'},headers=HEADERS).json()['id'];token=upload(client)
        with db.transaction() as c:c.execute("CREATE TRIGGER reject_music BEFORE UPDATE OF source_asset_id ON projects BEGIN SELECT RAISE(ABORT,'music fail'); END")
        with pytest.raises(Exception,match='music fail'):
            client.post(f'/api/v1/projects/{empty}/music',json={'upload_id':token},headers=HEADERS)
        assert not (tmp_path/'projects'/empty/'source').exists()
        assert not (tmp_path/'uploads'/token).exists()
        assert client.get(f'/api/v1/projects/{empty}').json()['asset'] is None

def test_restart_restores_uncommitted_delete_and_collects_committed_quarantine(tmp_path):
    with client_for(tmp_path) as client:
        pid=client.post('/api/v1/projects',json={'name':'recover'},headers=HEADERS).json()['id']
    directory=tmp_path/'projects'/pid;trash=tmp_path/'.deleting'/pid;trash.parent.mkdir();directory.rename(trash)
    with client_for(tmp_path) as client:
        assert directory.is_dir() and not trash.exists()
        assert client.get(f'/api/v1/projects/{pid}/document').status_code==200
    # Simulate bytes left after a committed deletion; no live project can claim these.
    orphan=trash.parent/'already-deleted';orphan.mkdir();(orphan/'file').write_bytes(b'old')
    with client_for(tmp_path):assert not orphan.exists()


def test_upload_reuses_digest_computed_from_received_bytes(tmp_path, monkeypatch):
    import hashlib
    import server.studio.media as media
    def redundant_hash(*args, **kwargs):
        raise AssertionError('uploaded bytes were already hashed while receiving')
    monkeypatch.setattr(media, 'content_hash', redundant_hash)
    payload = wav_bytes()
    with client_for(tmp_path) as client:
        response = client.post('/api/v1/uploads', files={'file':('music.wav',payload,'audio/wav')}, headers=HEADERS)
        assert response.status_code == 200, response.text
        token = response.json()['id']
        metadata = json.loads((tmp_path/'uploads'/token/'asset.json').read_text())
        assert metadata[1] == hashlib.sha256(payload).hexdigest()
        assert (tmp_path/'uploads'/token/'source/original').read_bytes() == payload
