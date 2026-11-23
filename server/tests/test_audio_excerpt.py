import io
import wave
from dataclasses import replace
from server.studio.media import MediaService
from server.tests.test_project_resources import client_for, HEADERS, binding
from server.tests.test_api import wav_bytes


def test_bounded_listening_endpoint_returns_mono_16k_wav_and_preserves_document(tmp_path):
    buffer = io.BytesIO()
    with wave.open(buffer, 'wb') as stream:
        stream.setnchannels(2)
        stream.setsampwidth(2)
        stream.setframerate(32000)
        stream.writeframes(b'\x10\x00\x20\x00' * (32000 * 31))
    with client_for(tmp_path) as client:
        pid = client.post('/api/v1/projects', json={'name': 'listening'}, headers=HEADERS).json()['id']
        url = f'/api/v1/projects/{pid}'
        assert client.get(url+'/audio-excerpt?start_ms=0&end_ms=100').status_code == 404
        token = client.post('/api/v1/uploads', files={'file': ('source.wav', buffer.getvalue(), 'audio/wav')}, headers=HEADERS).json()['id']
        assert client.post(url+'/music', json=binding(client, pid, token), headers=HEADERS).status_code == 200
        before = client.get(url+'/document').json()
        for start, end in [(-1,100), (200,200), (300,100), (0,30001), (30000,32000), (32000,33000)]:
            response = client.get(url+f'/audio-excerpt?start_ms={start}&end_ms={end}')
            assert response.status_code == 422, response.text
        assert client.get(url+'/audio-excerpt?start_ms=0&end_ms=100&source_asset_id=stale').status_code == 409
        for start, end in [(0,30000), (500,1250), (30000,31000)]:
            response = client.get(url+f'/audio-excerpt?start_ms={start}&end_ms={end}')
            assert response.status_code == 200, response.text
            assert response.headers['content-type'] == 'audio/wav'
            assert float(response.headers['x-actual-start-ms']) == start
            assert float(response.headers['x-actual-end-ms']) == end
            assert response.headers['x-sample-rate'] == '16000'
            assert response.headers['x-source-kind'] == 'original'
            with wave.open(io.BytesIO(response.content)) as stream:
                assert (stream.getframerate(),stream.getnchannels(),stream.getsampwidth()) == (16000,1,2)
                assert stream.getnframes() == (end-start)*16
        assert client.get(url+'/audio-excerpt?start_ms=0&end_ms=100&vocal=missing').status_code == 404
        assert client.get('/api/v1/projects/missing/audio-excerpt?start_ms=0&end_ms=100').status_code == 404
        assert client.get(url+'/document').json() == before
        assert client.delete(url, headers=HEADERS).status_code == 200


def test_container_tail_is_clipped_to_decoded_frames_with_actual_range(tmp_path, monkeypatch):
    with client_for(tmp_path) as client:
        token = client.post('/api/v1/uploads', files={'file': ('tail.wav', wav_bytes(), 'audio/wav')}, headers=HEADERS).json()['id']
        project = client.post('/api/v1/projects', json={'name': 'tail', 'upload_id': token}, headers=HEADERS).json()
        url = f'/api/v1/projects/{project["id"]}'
        assert project['asset']['source_duration_ms'] == 1000
        before = client.get(url+'/document').json()
        playback_proxy = MediaService.playback_proxy

        def shorter_proxy(media, asset):
            proxy = playback_proxy(media, asset)
            # A decoder may yield 20 ms less PCM than the probed container duration.
            frames = round(980 * proxy.rate / 1000)
            return replace(proxy, pcm=proxy.pcm[:frames * proxy.channels * 2])

        monkeypatch.setattr(MediaService, 'playback_proxy', shorter_proxy)
        response = client.get(url+'/audio-excerpt?start_ms=900&end_ms=1000')
        assert response.status_code == 200, response.text
        assert float(response.headers['x-actual-start-ms']) == 900
        assert float(response.headers['x-actual-end-ms']) == 980
        with wave.open(io.BytesIO(response.content)) as stream:
            assert (stream.getframerate(), stream.getnchannels(), stream.getnframes()) == (16000, 1, 80 * 16)
        assert client.get(url+'/audio-excerpt?start_ms=900&end_ms=1001').status_code == 422
        assert client.get(url+'/audio-excerpt?start_ms=990&end_ms=1000').status_code == 422
        assert client.get(url+'/document').json() == before
