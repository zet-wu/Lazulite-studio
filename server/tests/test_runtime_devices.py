import threading
import time
import pytest
from server.runtime_devices import RuntimeDevices, DeviceFailure
from server.runtime_settings import RuntimeSettings
from server.jobs import JobService
from server.db import Database
from server.tests.test_jobs import seed_project, wait_for
from server.tests.test_vocals import setup, wait


def test_device_snapshot_is_immutable_and_cpu_retry_does_not_save(tmp_path):
    settings = RuntimeSettings(tmp_path / 'settings.json')
    devices = RuntimeDevices(settings, {'target':'windows-x64-cuda'}, probe_fn=lambda wanted: {'actual':wanted,'reason':None,'runtime_ok':True})
    first = devices.snapshot('alignment')
    settings.patch({'device.vocal':'cpu'}, 0)
    assert first['vocal']['actual'] == 'cuda'
    assert devices.snapshot('alignment')['vocal']['actual'] == 'cpu'
    assert devices.snapshot('alignment')['alignment']['actual'] == 'cuda'
    assert all(s['actual'] == 'cpu' for s in devices.snapshot('alignment', cpu_retry=True).values())
    assert 'device.alignment' not in settings.read()['values']


def test_device_failure_does_not_automatically_rerun(tmp_path):
    db = Database(tmp_path / 'studio.sqlite3'); seed_project(db)
    calls = []
    class Runner:
        def run(self, *args): calls.append(args); raise DeviceFailure('vocal','cuda')
        def close(self): pass
        def clean_unregistered(self, *args): pass
    service = JobService(db, vocal_runner=Runner(), asset_path=lambda pid:'unused')
    job = service.create('p','vocal',{'asset_id':'a','device':'cuda'})
    result = wait_for(service,job['id'])
    assert result['status'] == 'failed' and result['error']['cpu_retry']
    assert len(calls) == 1
    service.close()


def test_cpu_retry_new_task_and_stale_revision_rejected(tmp_path):
    client, db = setup(tmp_path)
    headers = {'origin':'http://studio'}
    with client:
        revision = client.get('/api/v1/projects/p/document').json()['revision']
        import json
        with db.transaction() as c:
            c.execute("INSERT INTO jobs(id,project_id,kind,status,request_json,error_json,created_at,updated_at) VALUES('failed','p','vocal','failed',?,?,'0','0')", (json.dumps({'asset_id':'p','bound_revision':revision,'model_name':'htdemucs','device':'cuda'}), json.dumps({'code':'device_failed','cpu_retry':True})))
        assert client.post('/api/v1/jobs/failed/retry-cpu',json={'revision':'stale'},headers=headers).status_code == 409
        result = client.post('/api/v1/jobs/failed/retry-cpu',json={'revision':revision},headers={**headers,'Idempotency-Key':'fresh'}).json()
        assert result['id'] != 'failed'
        assert wait(client,result['id'])['status'] == 'succeeded'
        assert client.get('/api/v1/jobs/failed').json()['status'] == 'failed'
        assert 'device.vocal' not in client.get('/api/v1/settings').json()['values']
        rejected = client.post('/api/v1/jobs/'+result['id']+'/retry-cpu',json={'revision':revision},headers=headers)
        assert rejected.status_code == 409
        detail = rejected.json()
        assert detail['code'] == 'job_not_failed' and detail['retryable'] is False
        assert detail['reason'] == 'job_not_failed' and detail['params'] == {'kind':'vocal', 'status':'succeeded'}
        assert 'succeeded' in detail['message']


@pytest.mark.parametrize('kind,status,error,code,reason', [
    ('vocal','failed',{},'cpu_retry_not_available','cpu_retry_not_available'),
    ('alignment','failed',{'cpu_retry':False},'cpu_retry_not_available','cpu_retry_not_available'),
    ('legacy','failed',{'cpu_retry':True},'cpu_retry_unsupported_kind','unsupported_kind'),
    ('vocal','cancelled',{'cpu_retry':True},'job_not_failed','job_not_failed'),
])
def test_cpu_retry_rejection_explains_kind_status_and_availability(tmp_path,kind,status,error,code,reason):
    import json
    client, db = setup(tmp_path)
    with client:
        with db.transaction() as c:
            c.execute("INSERT INTO jobs(id,project_id,kind,status,request_json,error_json,created_at,updated_at) VALUES('guard','p',?,?,?,?,'0','0')",
                      (kind,status,json.dumps({}),json.dumps(error)))
        reply = client.post('/api/v1/jobs/guard/retry-cpu', json={'revision':'unused'}, headers={'origin':'http://studio'})
        assert reply.status_code == 409,reply.text
        detail = reply.json()
        assert detail['code'] == code and detail['reason'] == reason and detail['retryable'] is False
        assert detail['params'] == {'kind':kind,'status':status}
        assert len(client.get('/api/v1/projects/p/jobs').json()['items']) == 1


