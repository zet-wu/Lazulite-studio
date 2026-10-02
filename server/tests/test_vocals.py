import time
import threading
from pathlib import Path
import numpy as np
import soundfile as sf
from fastapi.testclient import TestClient
from server.app import create_app
from server.auth import Settings
from server.db import Database
from server.revisions import RevisionStore
from server.tests.media_fixture import add_media_project

class Separator:
    cache_identity = {'model': 'test-only', 'weights_sha256': 'test-weights'}
    def separate(self, audio):
        from lazulite.models.audio import AudioBuffer
        samples = np.zeros((2, round(audio.duration * 44100)), dtype=np.float32)
        samples[:, 22050:66150] = 1.5 * np.sin(np.arange(44100)*0.1)
        return AudioBuffer(samples, 44100, audio.source_id)
    def close(self): pass

def setup(tmp_path, factory=Separator):
    audio = tmp_path / 'source.wav'
    sf.write(audio, np.zeros((88200, 2)), 44100)
    db = Database(tmp_path / 'studio.sqlite3')
    add_media_project(tmp_path, db, RevisionStore(db,tmp_path/'revisions'), 'p', audio, '<tt xmlns="http://www.w3.org/ns/ttml"><body><div/></body></tt>')
    return TestClient(create_app(tmp_path, Settings(None, True, 'http://studio'), separator_factory=factory)), db

def wait(client, job):
    for _ in range(200):
        out = client.get('/api/v1/jobs/'+job).json()
        if out['status'] in {'succeeded','failed','cancelled'}: return out
        time.sleep(.02)
    raise AssertionError('task did not finish')

def test_vocal_flac_gain_explicit_adoption_and_source_validation(tmp_path):
    client, db = setup(tmp_path)
    with client:
        before = client.get('/api/v1/projects/p/document').json()
        asset = before['document']['sourceAssetId']
        job = client.post('/api/v1/projects/p/jobs/vocal', json={'params': {'asset_id': asset}}, headers={'origin':'http://studio'})
        assert job.status_code == 202
        assert wait(client,job.json()['id'])['status'] == 'succeeded'
        assert client.get('/api/v1/projects/p/document').json()['revision'] == before['revision']
        result = client.get('/api/v1/projects/p/vocals').json()['items'][0]
        assert result['status'] == 'ready' and result['gain'] < 1
        flac = tmp_path/'vocals'/'p'/result['id']/'vocals.flac'
        info = sf.info(flac)
        assert info.subtype == 'PCM_24' and info.frames == 88200 and info.channels == 2
        samples, _ = sf.read(flac)
        assert np.max(np.abs(samples)) < 1 and np.max(np.abs(samples[:22050])) == 0
        body = {k: before[k] for k in ('schema_version','project_id','revision','document')}
        body['document']['acoustics'] = {'analysisId':result['id'], 'segments':result['segments']}
        saved = client.put('/api/v1/projects/p/document',json=body,headers={'origin':'http://studio','if-match':before['revision']})
        assert saved.status_code == 200
        energy = client.get(f"/api/v1/projects/p/vocals/{result['id']}/energy?start_ms=0&end_ms=2000&buckets=10")
        assert energy.status_code == 200 and len(energy.json()['values']) <= 10
        assert client.get(f"/api/v1/projects/p/audio?vocal={result['id']}", headers={'range':'bytes=0-99'}).status_code == 206
        body['revision'] = saved.json()['revision']; body['document']['acoustics']['analysisId'] = 'foreign'
        assert client.put('/api/v1/projects/p/document',json=body,headers={'origin':'http://studio','if-match':body['revision']}).status_code == 422


def test_duplicate_and_boundary_cancel_keep_separated_audio(tmp_path):
    entered, release = threading.Event(), threading.Event()
    class Blocking(Separator):
        def separate(self,audio):
            entered.set(); release.wait(5)
            return super().separate(audio)
    client, db = setup(tmp_path, Blocking)
    with client:
        asset = client.get('/api/v1/projects/p/document').json()['document']['sourceAssetId']
        create = lambda: client.post('/api/v1/projects/p/jobs/vocal',json={'params':{'asset_id':asset}},headers={'origin':'http://studio'}).json()
        job = create(); assert entered.wait(3)
        assert create()['id'] == job['id']
        assert client.post('/api/v1/jobs/'+job['id']+'/cancel',headers={'origin':'http://studio'}).json()['status'] == 'cancel_requested'
        release.set(); assert wait(client, job['id'])['status'] == 'cancelled'
        result = client.get('/api/v1/projects/p/vocals').json()['items'][0]
        assert result['status'] == 'separated'
        retry = client.post('/api/v1/projects/p/jobs/vocal',json={'params':{'asset_id':asset,'retry_analysis_id':result['id']}},headers={'origin':'http://studio'}).json()
        assert wait(client,retry['id'])['status'] == 'succeeded'


def test_analysis_failure_is_retryable_and_restart_retains_ready_products(tmp_path, monkeypatch):
    import lazulite.audio.activity as activity
    real = activity.analyze_vocals
    client, db = setup(tmp_path)
    with client:
        before=client.get('/api/v1/projects/p/document').json()
        request={'params':{'asset_id':before['document']['sourceAssetId']}}
        def fail(*a,**k): raise RuntimeError('injected analysis failure')
        monkeypatch.setattr(activity,'analyze_vocals',fail)
        job=client.post('/api/v1/projects/p/jobs/vocal',json=request,headers={'origin':'http://studio'}).json()
        assert wait(client,job['id'])['status']=='failed'
        result=client.get('/api/v1/projects/p/vocals').json()['items'][0]
        assert result['status']=='separated'
        monkeypatch.setattr(activity,'analyze_vocals',real)
        request['params']['retry_analysis_id']=result['id']
        retry=client.post('/api/v1/projects/p/jobs/vocal',json=request,headers={'origin':'http://studio'}).json()
        assert wait(client,retry['id'])['status']=='succeeded'
    from server.vocals import VocalRunner
    orphan=tmp_path/'vocals'/'p'/'orphan';orphan.mkdir();(orphan/'temporary').write_text('partial')
    runner=VocalRunner(db,tmp_path/'vocals')
    assert not orphan.exists()
    assert runner.get('p',result['id'])[0]['status']=='ready'
    assert (tmp_path/'vocals'/'p'/result['id']/'vocals.flac').is_file()
