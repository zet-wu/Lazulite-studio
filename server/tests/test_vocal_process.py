import os
import threading
import time
import pytest
from server.vocal_process import VocalProcess
from server.vocals import VocalCancelled
from server.tests.test_vocals import setup, wait

@pytest.fixture
def isolated_worker(monkeypatch):
    from server import vocal_process
    original = vocal_process.subprocess.Popen
    def spawn(args, **kwargs):
        if args[-1] == 'server.vocal_worker':
            args = [*args[:-1], 'server.tests.vocal_worker_fixture']
        return original(args, **kwargs)
    monkeypatch.setattr(vocal_process.subprocess, 'Popen', spawn)

def test_api_remains_responsive_while_model_holds_child_gil(tmp_path, isolated_worker):
    client, db = setup(tmp_path, factory=None)
    with client:
        asset = client.get('/api/v1/projects/p').json()['asset']['id']
        job = client.post('/api/v1/projects/p/jobs/vocal', json={'params': {'asset_id': asset}}, headers={'origin':'http://studio'}).json()['id']
        for _ in range(100):
            value = client.get('/api/v1/jobs/'+job).json()
            if value['stage'] == 'separating': break
            time.sleep(.02)
        else: pytest.fail('worker did not start')
        start=time.monotonic()
        assert client.get('/api/v1/session').status_code == 200
        assert time.monotonic()-start < .5
        assert wait(client,job)['status'] == 'succeeded'
        result=client.get('/api/v1/jobs/'+job+'/result').json()
        assert result['engine']['worker_pid'] != os.getpid()

def test_child_crash_is_job_failure_and_api_survives(tmp_path, isolated_worker, monkeypatch):
    client, db = setup(tmp_path, factory=None)
    with client:
        asset = client.get('/api/v1/projects/p').json()['asset']['id']
        def submit():
            return client.post('/api/v1/projects/p/jobs/vocal', json={'params': {'asset_id': asset}}, headers={'origin': 'http://studio'}).json()['id']
        monkeypatch.setenv('STUDIO_TEST_VOCAL_CRASH', '1')
        assert wait(client, submit())['status'] == 'failed'
        assert client.get('/api/v1/session').status_code == 200
        monkeypatch.delenv('STUDIO_TEST_VOCAL_CRASH')
        assert wait(client, submit())['status'] == 'succeeded'

def test_cancel_at_boundary_and_shutdown_reap_child(tmp_path, isolated_worker):
    from server.db import Database
    db=Database(tmp_path/'studio.sqlite3')
    request={'database':db.path,'root':str(tmp_path/'projects'),'project_id':'p','asset_path':str(tmp_path/'source.wav'),'params':{},'job_id':'cancel'}
    runner=VocalProcess()
    with pytest.raises(VocalCancelled): runner.run(request,lambda *args:None,lambda:True)
    started=threading.Event();errors=[]
    request['params']={'seconds':20}
    def run():
        try: runner.run(request,lambda *args:started.set(),lambda:False)
        except RuntimeError as exc: errors.append(exc)
    thread=threading.Thread(target=run);thread.start()
    assert started.wait(5)
    process=runner._process
    runner.close();thread.join(5)
    assert not thread.is_alive() and process.poll() is not None and errors
