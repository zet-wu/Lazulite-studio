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
    assert runner.get('p',retry['id'])[0]['status']=='ready'
    assert (tmp_path/'vocals'/'p'/result['id']/'vocals.flac').is_file()


def test_ready_reanalysis_preserves_old_result(tmp_path):
    client, db = setup(tmp_path)
    with client:
        asset = client.get('/api/v1/projects/p/document').json()['document']['sourceAssetId']
        def run(reuse=None):
            params = {'asset_id': asset}
            if reuse: params['retry_analysis_id'] = reuse
            job = client.post('/api/v1/projects/p/jobs/vocal', json={'params': params}, headers={'origin':'http://studio'}).json()
            assert wait(client, job['id'])['status'] == 'succeeded'
            return job['id']
        old = run()
        directory = tmp_path/'vocals'/'p'/old
        before = {p.name: p.read_bytes() for p in directory.iterdir()}
        new = run(old)
        assert new != old
        assert before == {p.name: p.read_bytes() for p in directory.iterdir()}
        assert not (tmp_path/'vocals'/'p'/new/'vocals.flac').exists()
        assert client.get(f'/api/v1/projects/p/vocals/{new}/file').content == before['vocals.flac']
        items = client.get('/api/v1/projects/p/vocals').json()['items']
        assert {r['audio_id'] for r in items} == {old}
        assert {r['audio_state'] for r in items} == {'current'}
        assert client.get(f'/api/v1/projects/p/waveform?vocal={new}&level=0&start_ms=0&end_ms=500').status_code == 200


def test_energy_windows_match_persisted_rms_and_vocal_reads_do_not_reprobe(tmp_path, monkeypatch):
    client, db = setup(tmp_path)
    with client:
        asset = client.get('/api/v1/projects/p/document').json()['document']['sourceAssetId']
        job = client.post('/api/v1/projects/p/jobs/vocal', json={'params': {'asset_id': asset}}, headers={'origin':'http://studio'}).json()
        assert wait(client, job['id'])['status'] == 'succeeded'
        result = client.get('/api/v1/projects/p/vocals').json()['items'][0]
        rid = result['id']
        values = np.load(tmp_path/'vocals'/'p'/rid/'energy.npy')
        import math
        for start, end, buckets in [(0,2000,10),(511,1411,7),(0,100,4096),(1900,2300,1),(2300,2400,5)]:
            response = client.get(f'/api/v1/projects/p/vocals/{rid}/energy?start_ms={start}&end_ms={end}&buckets={buckets}')
            assert response.status_code == 200
            first = int(start/result['energy_hop_ms'])
            last = min(len(values), math.ceil(min(end, result['duration_ms'])/result['energy_hop_ms']))
            stride = max(1, math.ceil((last-first)/buckets))
            expected = [float(np.max(values[i:min(i+stride,last)])) for i in range(first,last,stride)]
            assert response.json()['values'] == expected
        import server.studio.media as media
        def unexpected(*args, **kwargs): raise AssertionError('immutable vocal metadata must not be probed again')
        monkeypatch.setattr(media, 'probe_media', unexpected)
        for start in (0, 100, 400):
            response = client.get(f'/api/v1/projects/p/waveform?vocal={rid}&level=0&start_ms={start}&end_ms={start+500}')
            assert response.status_code == 200 and response.json()['maximum']
        assert client.get(f'/api/v1/projects/p/audio?vocal={rid}', headers={'range':'bytes=0-99'}).status_code == 206


def test_current_lazulite_profile_is_unsmoothed_main_rms_with_centered_clock(tmp_path):
    class Asymmetric(Separator):
        def separate(self, audio):
            from lazulite.models.audio import AudioBuffer
            samples = np.zeros((2, 88200), dtype=np.float32)
            samples[0, 0], samples[1, 0] = .5, .25
            return AudioBuffer(samples, 44100, audio.source_id)
    client, db = setup(tmp_path, Asymmetric)
    with client:
        asset = client.get('/api/v1/projects/p/document').json()['document']['sourceAssetId']
        job = client.post('/api/v1/projects/p/jobs/vocal', json={'params': {'asset_id': asset}}, headers={'origin':'http://studio'}).json()
        assert wait(client, job['id'])['status'] == 'succeeded'
        result = client.get('/api/v1/projects/p/vocals').json()['items'][0]
        directory = tmp_path/'vocals'/'p'/result['id']
        from lazulite.audio.activity import VocalConfig, build_activity_profile
        from lazulite.models.audio import AudioBuffer
        samples, rate = sf.read(directory/'vocals.flac', dtype='float32', always_2d=True)
        config = VocalConfig()
        expected = build_activity_profile(AudioBuffer(samples.T, rate, asset), config=config)
        values = np.load(directory/'energy.npy')
        np.testing.assert_array_equal(values, expected['main_rms'])
        # Independent onset check: center padding includes sample zero at t=0;
        # asymmetric main extraction gives .25 rather than stereo mean .375.
        assert np.isclose(values[0], .25 / np.sqrt(config.frame_length))
        assert values[config.frame_length//(2*config.hop_length)+1] == 0
        assert len(values) == len(samples)//config.hop_length+1
        assert result['energy_hop_ms'] == config.hop_length * 1000 / rate
        assert result['analysis_config']['frame_length'] == 2048
        assert result['analysis_version'] == 'lazulite-vocal-core-v2-main-rms'
        assert 'scipy' in result['runtime']
        energy = client.get(f"/api/v1/projects/p/vocals/{result['id']}/energy?start_ms=0&end_ms=100&buckets=4096").json()
        assert energy['start_ms'] == 0
        assert energy['values'][0] == float(values[0])


def test_cached_separation_reanalysis_repair_and_version_update(tmp_path, monkeypatch):
    class Counted(Separator):
        calls = 0
        def separate(self, audio):
            Counted.calls += 1
            return super().separate(audio)
    client, db = setup(tmp_path, Counted)
    with client:
        asset = client.get('/api/v1/projects/p/document').json()['document']['sourceAssetId']
        def run(reuse=None):
            params = {'asset_id': asset, **({'retry_analysis_id': reuse} if reuse else {})}
            job = client.post('/api/v1/projects/p/jobs/vocal', json={'params': params}, headers={'origin':'http://studio'}).json()
            assert wait(client, job['id'])['status'] == 'succeeded'
            return client.get(f"/api/v1/jobs/{job['id']}/result").json()['analysis_id']
        first = run()
        assert run() == first and Counted.calls == 1
        second = run(first)
        assert second != first and Counted.calls == 1
        assert len(list((tmp_path/'vocals').rglob('vocals.flac'))) == 1
        assert run() == second
        # Valid FLAC header but changed bytes must also invalidate the cached file.
        path = tmp_path/'vocals'/'p'/first/'vocals.flac'
        with path.open('ab') as f: f.write(b'corruption')
        assert {r['audio_state'] for r in client.get('/api/v1/projects/p/vocals').json()['items']} == {'missing'}
        repaired = run(second)
        assert Counted.calls == 2 and repaired not in (first, second)
        path = tmp_path/'vocals'/'p'/repaired/'vocals.flac'
        path.unlink()
        restored = run()
        assert Counted.calls == 3
        monkeypatch.setenv('STUDIO_VOCAL_MODEL', 'new-fixed-model')
        assert client.get('/api/v1/projects/p/vocals').json()['items'][0]['audio_state'] == 'outdated'
        updated = run()
        assert updated != restored and Counted.calls == 4
        assert (tmp_path/'vocals'/'p'/restored/'vocals.flac').exists()
        assert client.get('/api/v1/projects/p/vocals').json()['items'][0]['audio_state'] == 'current'


def test_restart_keeps_shared_audio_and_project_deletion_releases_it(tmp_path):
    client, db = setup(tmp_path)
    with client:
        asset = client.get('/api/v1/projects/p/document').json()['document']['sourceAssetId']
        def run(reuse=None):
            params = {'asset_id': asset, **({'retry_analysis_id': reuse} if reuse else {})}
            job = client.post('/api/v1/projects/p/jobs/vocal', json={'params': params}, headers={'origin':'http://studio'}).json()
            assert wait(client, job['id'])['status'] == 'succeeded'
            return job['id']
        first = run()
        second = run(first)
    before = {str(p): p.read_bytes() for p in (tmp_path/'vocals').rglob('*') if p.is_file()}
    from server.vocals import VocalRunner
    runner = VocalRunner(db,tmp_path/'vocals',Separator)
    for result_id in (first, second):
        _, metadata = runner.get('p',result_id)
        assert metadata['audio_result_id'] == first
        assert metadata['separation_signature'] and metadata['audio_sha256']
        assert runner.audio_path('p',metadata) == tmp_path/'vocals'/'p'/first/'vocals.flac'
        assert runner.audio_available('p', metadata)
    assert before == {str(p): p.read_bytes() for p in (tmp_path/'vocals').rglob('*') if p.is_file()}
    with TestClient(create_app(tmp_path, Settings(None, True, 'http://studio'), separator_factory=Separator)) as client:
        assert client.get(f'/api/v1/projects/p/vocals/{second}/file').status_code == 200
        assert client.delete('/api/v1/projects/p',headers={'origin':'http://studio'}).status_code == 200
    assert not list((tmp_path/'vocals').rglob('vocals.flac'))
