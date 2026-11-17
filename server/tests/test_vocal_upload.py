import io
import numpy as np
import soundfile as sf
import pytest
from server.tests.test_vocals import setup, wait
from server.vocal_offset import estimate_offset, shift_samples, RATE


def test_uniform_offset_accepts_shift_and_rejects_silence_wrong_audio_drift():
    rng = np.random.default_rng(81)
    source = rng.normal(0, .1, 60*RATE).astype(np.float32)
    assert estimate_offset(source, source[2474:]) == 1237
    assert estimate_offset(source, np.pad(source, (6902, 0))) == -3451
    assert estimate_offset(source, np.zeros_like(source)) is None
    assert estimate_offset(source, rng.normal(0, .1, len(source))) is None
    from scipy.signal import resample
    assert estimate_offset(source, resample(source, len(source)-500)) is None
    assert estimate_offset(source[:RATE], source[:RATE]) is None


def test_signed_shift_crops_and_pads_without_rate_change():
    source = np.array([[1,2,3,4]], dtype=np.float32)
    assert shift_samples(source, 5, 1000, 2).tolist() == [[0,0,1,2,3]]
    assert shift_samples(source, 5, 1000, -2).tolist() == [[3,4,0,0,0]]
    with pytest.raises(ValueError): shift_samples(source, 5, 1000, 5)


def test_uploaded_vocals_analyze_without_separator_and_retry_same_audio(tmp_path):
    def forbidden(): raise AssertionError('upload must not separate')
    client, db = setup(tmp_path, forbidden)
    upload = io.BytesIO(); sf.write(upload, .2*np.sin(np.arange(48000)*.1), 48000, format='WAV')
    with client:
        headers={'origin':'http://studio'}
        staged=client.post('/api/v1/uploads',files={'file':('external.wav',upload.getvalue(),'audio/wav')},headers=headers)
        assert staged.status_code == 200, staged.text
        uid=staged.json()['id']
        result=client.post('/api/v1/projects/p/jobs/vocal',json={'params':{'asset_id':'p','upload_id':uid,'offset_ms':250}},headers=headers)
        assert result.status_code == 202, result.text
        job=wait(client,result.json()['id']);assert job['status']=='succeeded',job
        item=client.get('/api/v1/projects/p/vocals').json()['items'][0]
        assert item['source_kind']=='upload' and item['original_filename']=='external.wav'
        assert item['frames']==96000 and item['offset_ms']==250 and item['audio_state']=='current'
        from server.vocals import VocalRunner
        runner=VocalRunner(db,tmp_path/'projects',cleanup=False)
        samples,rate=runner.decoded_audio('p',item)
        assert rate==48000 and np.max(np.abs(samples[:11000])) < .001
        assert np.max(np.abs(samples[13000:20000])) > .1
        retry=client.post('/api/v1/projects/p/jobs/vocal',json={'params':{'asset_id':'p','retry_analysis_id':item['id']}},headers=headers)
        assert wait(client,retry.json()['id'])['status']=='succeeded'
        latest=client.get('/api/v1/projects/p/vocals').json()['items'][0]
        assert latest['audio_id']==item['id'] and latest['source_kind']=='upload'
        runner.close()
        assert client.post('/api/v1/projects/p/vocal-offset',json={'asset_id':'wrong','upload_id':uid},headers=headers).status_code==409
        assert client.post('/api/v1/projects/p/jobs/vocal',json={'params':{'asset_id':'p','upload_id':uid,'offset_ms':'bad'}},headers=headers).status_code==422


def test_analysis_failure_preserves_old_result_and_can_retry_uploaded_track(tmp_path, monkeypatch):
    client, db = setup(tmp_path)
    buf=io.BytesIO();sf.write(buf,np.zeros((48000,2)),48000,format='WAV')
    headers={'origin':'http://studio'}
    with client:
        old=client.post('/api/v1/projects/p/jobs/vocal',json={'params':{'asset_id':'p'}},headers=headers).json()
        assert wait(client,old['id'])['status']=='succeeded'
        uid=client.post('/api/v1/uploads',files={'file':('vocal.wav',buf.getvalue())},headers=headers).json()['id']
        def fail(*args,**kwargs): raise ValueError('analysis failed')
        monkeypatch.setattr('lazulite.audio.activity.analyze_vocals',fail)
        job=client.post('/api/v1/projects/p/jobs/vocal',json={'params':{'asset_id':'p','upload_id':uid,'offset_ms':0}},headers=headers).json()
        assert wait(client,job['id'])['status']=='failed'
        items=client.get('/api/v1/projects/p/vocals').json()['items']
        assert items[0]['status']=='separated' and items[1]['id']==old['id']
        assert client.get(f"/api/v1/projects/p/vocals/{old['id']}/file").status_code==200
        monkeypatch.undo()
        retry=client.post('/api/v1/projects/p/jobs/vocal',json={'params':{'asset_id':'p','retry_analysis_id':job['id']}},headers=headers).json()
        assert wait(client,retry['id'])['status']=='succeeded'
        latest=client.get('/api/v1/projects/p/vocals').json()['items'][0]
        assert latest['source_kind']=='upload' and latest['audio_id']==job['id']


def test_uploaded_audio_runs_in_real_worker_process(tmp_path):
    from fastapi.testclient import TestClient
    from server.app import create_app
    from server.auth import Settings
    buf=io.BytesIO();sf.write(buf,.2*np.sin(np.arange(96000)*.1),48000,format='WAV')
    headers={'origin':'http://studio'}
    with TestClient(create_app(tmp_path,Settings(None,True))) as client:
        def upload():return client.post('/api/v1/uploads',files={'file':('audio.wav',buf.getvalue())},headers=headers).json()['id']
        pid=client.post('/api/v1/projects',json={'name':'worker','upload_id':upload()},headers=headers).json()['id']
        asset=client.get(f'/api/v1/projects/{pid}').json()['asset']['id']
        task=client.post(f'/api/v1/projects/{pid}/jobs/vocal',json={'params':{'asset_id':asset,'upload_id':upload(),'offset_ms':0}},headers=headers).json()
        import time
        for _ in range(100):
            result=client.get('/api/v1/jobs/'+task['id']).json()
            if result['status'] in {'succeeded','failed'}:break
            time.sleep(.2)
        assert result['status']=='succeeded',result
        vocal=client.get(f'/api/v1/projects/{pid}/vocals').json()['items'][0]
        assert vocal['source_kind']=='upload' and vocal['frames']==96000
