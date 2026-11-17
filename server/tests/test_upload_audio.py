import json
import numpy as np
import subprocess
import pytest
from server.upload_audio import normalize_upload
from server.studio.media import MediaService

@pytest.mark.parametrize('codec,extension', [('aac','mp4'),('flac','mkv'),('libopus','mkv')])
def test_video_keeps_only_first_audio_and_playback_timeline(tmp_path, codec, extension):
    source=tmp_path/f'video.{extension}'
    subprocess.run(['ffmpeg','-y','-v','error','-f','lavfi','-i','color=black:s=64x64:r=5:d=3',
        '-f','lavfi','-i','sine=frequency=440:duration=2.013','-f','lavfi','-i','sine=frequency=880:duration=3',
        '-map','0:v','-map','1:a','-map','2:a','-c:v','mpeg4','-c:a',codec,str(source)],check=True)
    output,name=normalize_upload(source,'original.'+extension)
    info=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_streams','-of','json',str(output)]))
    assert len(info['streams'])==1 and info['streams'][0]['codec_type']=='audio'
    first=MediaService(tmp_path/'before');second=MediaService(tmp_path/'after')
    before=first.playback_proxy(first.import_asset(source))
    after=second.playback_proxy(second.import_asset(output,name))
    assert len(before.pcm)==len(after.pcm) and before.duration_ms==after.duration_ms
    assert np.max(np.abs(np.frombuffer(before.pcm,'<i2').astype(np.int32)-np.frombuffer(after.pcm,'<i2'))) <= 1
    assert source.exists() and name.endswith(output.suffix)


def test_video_upload_archive_metadata_and_independent_import(tmp_path):
    from fastapi.testclient import TestClient
    from server.app import create_app
    from server.auth import Settings
    from server.tests.test_project_archive import entries, upload, HEADERS
    video=tmp_path/'input.mp4'
    subprocess.run(['ffmpeg','-y','-v','error','-f','lavfi','-i','color=black:s=128x128:r=20:d=3',
        '-itsoffset','0.217','-f','lavfi','-i','sine=frequency=440:duration=2.013','-c:v','mpeg4','-c:a','aac',str(video)],check=True)
    original=video.read_bytes()
    with TestClient(create_app(tmp_path/'source',Settings(None,True))) as client:
        staged=client.post('/api/v1/uploads',files={'file':('video.mp4',original,'video/mp4')},headers=HEADERS)
        assert staged.status_code==200,staged.text
        asset=staged.json();assert asset['content_type'].startswith('audio/') and asset['filename']!='video.mp4'
        created=client.post('/api/v1/projects',json={'name':'video','upload_id':asset['id']},headers=HEADERS)
        assert created.status_code==200,created.text
        pid=created.json()['id'];saved=client.get(f'/api/v1/projects/{pid}').json()['asset']
        archive=client.get(f'/api/v1/projects/{pid}/archive').content
        files=entries(archive);media=next(name for name in files if name.startswith('media/'))
        assert len(files[media])==saved['size_bytes']
        playback=client.get(f'/api/v1/projects/{pid}/audio').content
    with TestClient(create_app(tmp_path/'destination',Settings(None,True))) as target:
        result=upload(target,archive);assert result.status_code==200,result.text
        pid=result.json()['id'];restored=target.get(f'/api/v1/projects/{pid}').json()['asset']
        assert restored['asset_hash']==saved['asset_hash'] and restored['duration_ms']==saved['duration_ms']
        assert target.get(f'/api/v1/projects/{pid}/audio').content==playback
    assert video.read_bytes()==original
