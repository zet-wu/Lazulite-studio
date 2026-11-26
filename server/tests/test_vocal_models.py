import json
from pathlib import Path
import pytest
from server.runtime_settings import RuntimeSettings
from server.vocal_models import VocalModels, check_snapshot
from server.tests.test_vocals import setup, wait, Separator


def test_catalog_directory_snapshot_and_missing_resources(tmp_path):
    settings=RuntimeSettings(tmp_path/'settings.json')
    models=VocalModels(settings,tmp_path)
    root=tmp_path/'vocal-models'
    bs=root/'bs-karaoke';bs.mkdir(parents=True)
    (bs/'bs_roformer_karaoke_frazer_becruily.ckpt').write_bytes(b'weights')
    (bs/'config_karaoke_frazer_becruily.yaml').write_text('audio: {}')
    assert [i['status'] for i in models.scan()['items']]==['invalid','ready']
    settings.patch({'studio:vocal-model':'bs-karaoke'},0)
    assert models.capture('bs-karaoke')['type']=='bs-karaoke'
    with pytest.raises(ValueError,match='ID'):models.capture('unknown')
    captured=models.capture()
    settings.patch({'studio:vocal-model':'demucs'},1)
    assert captured['type']=='bs-karaoke'
    assert captured['configuration_yaml']=='audio: {}'
    check_snapshot(captured)
    (bs/'config_karaoke_frazer_becruily.yaml').write_text('audio: {changed: true}')
    with pytest.raises(ValueError,match='已改变'):check_snapshot(captured)
    custom=tmp_path/'custom';custom.mkdir()
    assert models.apply(str(custom))['directory']==str(custom)
    assert models.apply(None)['directory']==str(root)
    assert RuntimeSettings(settings.path).read()['values']['studio:vocal-model']=='demucs'


def test_cross_model_reuse_explicit_recompute_and_reanalysis(tmp_path):
    calls=[]
    class Counted(Separator):
        def separate(self,audio):calls.append(audio.source_id);return super().separate(audio)
    client,db=setup(tmp_path,Counted)
    headers={'origin':'http://studio'}
    with client:
        asset=client.get('/api/v1/projects/p').json()['asset']['id']
        def run(**extra):
            response=client.post('/api/v1/projects/p/jobs/vocal',json={'params':{'asset_id':asset,**extra}},headers=headers)
            assert response.status_code==202,response.text
            job=wait(client,response.json()['id']);assert job['status']=='succeeded',job
            return client.get('/api/v1/jobs/'+job['id']+'/result').json()['analysis_id']
        first=run()
        preferences=client.get('/api/v1/settings')
        assert client.patch('/api/v1/settings',json={'changes':{'studio:vocal-model':'bs-karaoke'}},headers={**headers,'if-match':preferences.headers['etag']}).status_code==200
        assert run()==first and len(calls)==1
        assert all(r['audio_state']=='current' for r in client.get('/api/v1/projects/p/vocals').json()['items'])
        second=run(force_separation=True)
        assert second!=first and len(calls)==2
        analysis=run(retry_analysis_id=first)
        assert len(calls)==2
        records={r['id']:r for r in client.get('/api/v1/projects/p/vocals').json()['items']}
        assert records[analysis]['audio_result_id']==first
        assert records[second]['audio_result_id']==second
        assert client.get(f'/api/v1/projects/p/vocals/{first}/file').status_code==200


def test_queued_device_snapshot_is_fixed(tmp_path):
    from server.db import Database
    from server.jobs import JobService
    from server.runtime_devices import RuntimeDevices
    from server.tests.test_jobs import seed_project
    db=Database(tmp_path/'jobs.sqlite3');seed_project(db)
    settings=RuntimeSettings(tmp_path/'settings.json')
    devices=RuntimeDevices(settings,{'target':'windows-x64-cuda'},probe_fn=lambda d:{'actual':d,'runtime_ok':True})
    service=JobService(db,devices=devices)
    service._pool.submit=lambda *a,**k:None
    try:
        job=service.create('p','vocal',{'asset_id':'a','model_name':'BS Karaoke','_vocal_model':{'type':'bs-karaoke','config':{'model_repo':'original'},'files':[]}})
        settings.patch({'device.vocal':'cpu','studio:vocal-model':'demucs'},0)
        frozen=service.get(job['id'])['request']
        assert frozen['devices']['vocal']['actual']=='cuda'
        assert frozen['_vocal_model']['config']['model_repo']=='original'
    finally:service.close()


def test_cpu_retry_retains_original_model_and_force_intent(tmp_path):
    client,db=setup(tmp_path)
    with client:
        revision=client.get('/api/v1/projects/p/document').json()['revision']
        params={'asset_id':'p','bound_revision':revision,'model_name':'BS Karaoke','device':'cuda','force_separation':True,
                '_vocal_model':{'type':'bs-karaoke','name':'BS Karaoke','config':{'model_repo':'original'},'files':[]}}
        with db.transaction() as c:
            c.execute("INSERT INTO jobs(id,project_id,kind,status,request_json,error_json,created_at,updated_at) VALUES('failed','p','vocal','failed',?,?,'0','0')",(json.dumps(params),json.dumps({'code':'device_failed','cpu_retry':True})))
        response=client.post('/api/v1/jobs/failed/retry-cpu',json={'revision':revision},headers={'origin':'http://studio'})
        assert response.status_code==202,response.text
        job=wait(client,response.json()['id']);assert job['status']=='succeeded',job
        with db.connect() as c:
            request=json.loads(c.execute('SELECT request_json FROM jobs WHERE id=?',(job['id'],)).fetchone()[0])
        assert request['_vocal_model']==params['_vocal_model']
        assert request['device']=='cpu' and request['force_separation'] is True


def test_per_request_model_reuses_only_matching_results(tmp_path, monkeypatch):
    root = tmp_path/'models'
    demucs = root/'demucs'; demucs.mkdir(parents=True)
    (demucs/'htdemucs.yaml').write_text('models: [test]')
    (demucs/'test-weights.th').write_bytes(b'fixture')
    bs = root/'bs-karaoke'; bs.mkdir()
    (bs/'bs_roformer_karaoke_frazer_becruily.ckpt').write_bytes(b'fixture')
    (bs/'config_karaoke_frazer_becruily.yaml').write_text('audio: {}')
    monkeypatch.setenv('STUDIO_VOCAL_MODELS_DIR',str(root))
    calls=[]
    class Counted(Separator):
        def separate(self,audio): calls.append(audio.source_id);return super().separate(audio)
    client,db=setup(tmp_path,Counted)
    with client:
        asset=client.get('/api/v1/projects/p').json()['asset']['id']
        def run(model):
            reply=client.post('/api/v1/projects/p/jobs/vocal',json={'params':{'asset_id':asset,'model_id':model}},headers={'origin':'http://studio'})
            assert reply.status_code==202,reply.text
            job=wait(client,reply.json()['id']);assert job['status']=='succeeded',job
            return client.get('/api/v1/jobs/'+job['id']+'/result').json()['analysis_id']
        first=run('demucs');second=run('bs-karaoke')
        assert first!=second and len(calls)==2
        assert run('demucs')==first and run('bs-karaoke')==second and len(calls)==2
        for invalid in ['other',None,42]:
            reply=client.post('/api/v1/projects/p/jobs/vocal',json={'params':{'asset_id':asset,'model_id':invalid}},headers={'origin':'http://studio'})
            assert reply.status_code==422
        assert client.get('/api/v1/settings').json()['values'].get('studio:vocal-model','demucs')=='demucs'
