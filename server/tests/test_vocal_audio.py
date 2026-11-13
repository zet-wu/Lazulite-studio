import json
import subprocess
import numpy as np
import pytest
from server.vocal_audio import encode_vocals, asset, analysis_samples, FORMAT
from server.studio.media import MediaService


@pytest.mark.parametrize('rate,frames', [(44100, 88213), (48000, 96017)])
def test_aac_edit_list_preserves_onsets_and_exact_valid_tail(tmp_path, rate, frames):
    samples = np.zeros((2, frames), dtype=np.float32)
    positions = [0, rate // 2, frames - 1500]
    for index in positions:
        samples[:, index] = .8
    path = tmp_path/'vocals.m4a'
    metadata = encode_vocals(path, samples, rate, 1)
    metadata.update(audio_result_id='test', duration_ms=round(frames*1000/rate), sample_rate=rate, frames=frames)
    media = MediaService(tmp_path/'project')
    proxy = media.playback_proxy(asset(path, metadata))
    decoded = analysis_samples(proxy)
    assert len(decoded) == frames and proxy.decoded_frames >= frames
    for index in positions:
        begin, end = max(0, index-200), min(frames, index+200)
        assert begin + np.argmax(np.abs(decoded[begin:end, 0])) == index
    # First packet's negative timestamp and skip metadata show encoder delay;
    # FFmpeg consumes this metadata, while only tail padding is length-clipped.
    packet = json.loads(subprocess.check_output(['ffprobe','-v','error','-read_intervals','%+#1',
        '-show_packets','-of','json',str(path)]))['packets'][0]
    assert int(packet['pts']) < 0
    assert packet['side_data_list'][0]['skip_samples'] == -int(packet['pts'])
    media.clear()
    np.testing.assert_array_equal(decoded, analysis_samples(media.playback_proxy(asset(path, metadata))))


def test_failed_encoding_never_registers_and_legacy_products_stay_on_disk(tmp_path, monkeypatch):
    from server.tests.test_vocals import setup, wait
    client, db = setup(tmp_path)
    def fail(*args, **kwargs): raise subprocess.CalledProcessError(1, 'ffmpeg')
    monkeypatch.setattr('server.vocal_audio.run', fail)
    with client:
        result = client.post('/api/v1/projects/p/jobs/vocal', json={'params':{'asset_id':'p'}}, headers={'origin':'http://studio'}).json()
        assert wait(client, result['id'])['status'] == 'failed'
        assert client.get('/api/v1/projects/p/vocals').json()['items'] == []
        assert not list((tmp_path/'projects').rglob('*.m4a'))
    monkeypatch.undo()
    from server.vocals import VocalRunner
    directory = tmp_path/'projects/p/vocals/legacy'; directory.mkdir(parents=True)
    original = directory/'vocals.wav'; original.write_bytes(b'old computed result')
    metadata = {'audio_result_id':'legacy','format':'WAV PCM_16'}
    with db.transaction() as c:
        c.execute('INSERT INTO vocal_results VALUES(?,?,?,?,?,?)',('legacy','p','p','ready',db.paths.store(directory),json.dumps(metadata)))
    runner = VocalRunner(db,tmp_path/'projects',cleanup=True)
    assert not runner.audio_available('p',metadata)
    assert original.read_bytes() == b'old computed result'
    runner.close()
