import pytest
from fastapi.testclient import TestClient
from server.app import create_app
from server.auth import Settings
from server.project_storage import project_storage
from server.tests.test_vocals import setup, wait


def test_space_counts_real_files_history_and_changes(tmp_path):
    client,db=setup(tmp_path)
    with client:
        directory=tmp_path/'projects/p'
        def check():
            response=client.get('/api/v1/projects/p/storage');assert response.status_code==200,response.text
            value=response.json()
            assert value['total_bytes']==sum(path.stat().st_size for path in directory.rglob('*') if path.is_file())
            assert value['total_bytes']==sum(value['categories'].values())
            return value['categories']
        before=check()
        assert before['source']==(directory/'source/original').stat().st_size
        assert before['cache']>0 and before['snapshots']>0 and before['vocals']==0
        envelope=client.get('/api/v1/projects/p/document').json()
        from server.revisions import RevisionStore
        RevisionStore(db,tmp_path/'projects').create('p',envelope['document'],envelope['revision'])
        assert check()['snapshots']>before['snapshots']
        client.get('/api/v1/projects/p/waveform?start_ms=0&end_ms=2000')
        assert check()['cache']>before['cache']
        job=client.post('/api/v1/projects/p/jobs/vocal',json={'params':{'asset_id':'p'}},headers={'origin':'http://studio'}).json()
        assert wait(client,job['id'])['status']=='succeeded'
        value=check()
        assert value['vocals']==sum(path.stat().st_size for path in (directory/'vocals').rglob('*') if path.is_file())
        assert value['vocals']>(directory/'vocals'/job['id']/'vocals.wav').stat().st_size
        # Neither database nor another project's files are attributed to p.
        (tmp_path/'unrelated').write_bytes(b'x'*2000)
        assert check()==value


def test_space_uses_logical_bytes_and_reports_failure(tmp_path):
    with TestClient(create_app(tmp_path,Settings(None,True,'http://studio'))) as client:
        pid=client.post('/api/v1/projects',json={'name':'size'},headers={'origin':'http://studio'}).json()['id']
        root=tmp_path/'projects'/pid
        with (root/'sparse').open('wb') as f:f.truncate(1024**2)
        assert project_storage(root)['categories']['other']==1024**2
        (root/'link').symlink_to(tmp_path/'studio.sqlite3')
        assert client.get(f'/api/v1/projects/{pid}/storage').status_code==503
        assert client.get('/api/v1/projects/missing/storage').status_code==404
