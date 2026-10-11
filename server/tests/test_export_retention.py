import json
import threading
from pathlib import Path
from server.app import create_app
from server.auth import Settings
from fastapi.testclient import TestClient
from server.db import Database
from server.jobs import JobService
from .test_publish import _headers, _project, _save, _wait


def test_recent_success_failure_cancel_and_single_active(tmp_path):
    from server.publish import MediaPublisher
    class Publisher(MediaPublisher):
        block = False
        fail = False
        entered = threading.Event()
        release = threading.Event()
        def publish(self, *args):
            if self.block:
                self.entered.set()
                assert self.release.wait(5)
            if self.fail: raise ValueError('intentional publisher failure')
            return super().publish(*args)
    publisher = Publisher()
    settings = Settings('pw',False,'http://studio')
    with TestClient(create_app(tmp_path,settings,publisher=publisher),base_url='https://studio') as client:
        headers = _headers(client,settings); pid,asset = _project(client,headers,tmp_path)
        initial = client.get(f'/api/v1/projects/{pid}/document').json()['revision']
        revision = _save(client,headers,pid,initial,'<tt xmlns="http://www.w3.org/ns/ttml"><body><p begin="0" end="1">hello</p></body></tt>')
        body = dict(revision=revision,asset_id=asset,lrc_kind='lrc',lrc_text='[00:00.000]hello\n')
        url=f'/api/v1/projects/{pid}/publish'
        def submit():
            response=client.post(url,json=body,headers=headers)
            assert response.status_code==202,response.text
            return response.json()['id']
        def downloads(): return [x for x in client.get(f'/api/v1/projects/{pid}/exports').json()['items'] if x['download_url']]
        old=None
        route=next(route for route in client.app.routes if getattr(route,'path','').endswith('/exports/{job_id}/download'))
        for _ in range(3):
            stream=route.endpoint(pid,old) if old else None
            job=submit(); assert _wait(client,job)['status']=='succeeded'
            assert len(downloads())==1
            assert len(list((tmp_path/'projects'/pid/'exports').iterdir()))==1
            if old:
                assert client.get(f'/api/v1/projects/{pid}/exports/{old}/download').json()['code']=='export_replaced'
                import asyncio
                async def read_open_download():
                    return b''.join([chunk async for chunk in stream.body_iterator])
                assert b'ftyp' in asyncio.run(read_open_download())[:32]
            old=job
        publisher.fail=True
        job=submit(); assert _wait(client,job)['status']=='failed'
        assert downloads()[0]['id']==old
        publisher.fail=False; publisher.block=True
        job=submit(); assert publisher.entered.wait(5)
        assert client.post(url,json=body,headers=headers).status_code==409
        assert downloads()[0]['id']==old
        assert client.post(f'/api/v1/jobs/{job}/cancel',headers=headers).status_code==200
        publisher.release.set()
        assert _wait(client,job)['status']=='cancelled'
        assert downloads()[0]['id']==old
        assert len(list((tmp_path/'projects'/pid/'exports').iterdir()))==1


def test_startup_converges_history_and_orphans_and_retries_windows_lock(tmp_path,monkeypatch):
    db=Database(tmp_path/'db.sqlite3')
    root=tmp_path/'projects';root.mkdir()
    class Runner: output_root=root
    with db.transaction() as c:
        for pid in ('p','q'):
            c.execute('INSERT INTO projects VALUES(?,?,?,?,?,?)',(pid,pid,None,None,'now','now'))
        for i,pid in [(1,'p'),(2,'p'),(3,'q')]:
            path=root/pid/'exports'/f'{i}.m4a';path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(b'media')
            c.execute('INSERT INTO jobs(id,project_id,kind,status,request_json,result_json,created_at,updated_at,finished_at) VALUES(?,?,?,?,?,?,?,?,?)',(str(i),pid,'publish','succeeded','{}',json.dumps(dict(output_path=db.paths.store(path),report=dict(passed=True))),str(i),str(i),str(i)))
    (root/'p'/'exports'/'interrupted.m4a').write_bytes(b'partial')
    unlink=Path.unlink
    def locked(path,*args,**kwargs):
        if path.name=='1.m4a': raise PermissionError('Windows file is in use')
        return unlink(path,*args,**kwargs)
    monkeypatch.setattr(Path,'unlink',locked)
    service=JobService(db,publish_runner=Runner())
    assert {p.name for p in root.glob('*/exports/*')}=={'1.m4a','2.m4a','3.m4a'}
    assert service.result('1')['superseded'] is True
    monkeypatch.setattr(Path,'unlink',unlink)
    service.reconcile_exports()
    assert {p.name for p in root.glob('*/exports/*')}=={'2.m4a','3.m4a'}
    service.close()
