from server.project_document import initial_project, read_lyrics
from server.time_units import normalize_ttml
import subprocess
import time

from fastapi.testclient import TestClient

from server.app import create_app
from server.auth import Settings


def _headers(client, settings):
    login = client.post("/api/v1/session", json={"password": "pw"}, headers={"origin": settings.origin})
    assert login.status_code == 200
    return {"origin": settings.origin, "x-csrf-token": login.cookies["studio_csrf"]}


def _m4a(path):
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-c:a", "aac", str(path)], check=True)


def _project(client, headers, tmp_path):
    media = tmp_path / "tone.m4a"
    _m4a(media)
    uploaded = client.post("/api/v1/uploads", files={"file": ("tone.m4a", media.read_bytes(), "audio/mp4")}, headers=headers)
    assert uploaded.status_code == 200
    made = client.post("/api/v1/projects", json={"name": "Tone", "upload_id": uploaded.json()["id"]}, headers={**headers, "idempotency-key": "project"})
    assert made.status_code == 200
    return made.json()["id"], uploaded.json()["id"]


def _save(client, headers, pid, revision, text):
    body = {"schema_version": "studio-document-v9", "project_id": pid, "revision": revision,
            "document": initial_project(text, client.get(f"/api/v1/projects/{pid}").json()["asset"]["id"])}
    out = client.put(f"/api/v1/projects/{pid}/document", json=body, headers={**headers, "if-match": f'"{revision}"', "idempotency-key": revision + "-save"})
    assert out.status_code == 200
    return out.json()["revision"]


def _wait(client, job):
    for _ in range(100):
        value = client.get(f"/api/v1/jobs/{job}").json()
        if value["status"] in {"succeeded", "failed", "cancelled"}:
            return value
        time.sleep(0.02)
    raise AssertionError("publish job did not finish")


def test_publish_real_http_old_revision_idempotency_and_missing_file(tmp_path):
    settings = Settings("pw", False, "http://studio")
    client = TestClient(create_app(tmp_path, settings), base_url="https://studio")
    headers = _headers(client, settings)
    pid, asset = _project(client, headers, tmp_path)
    empty = client.get(f"/api/v1/projects/{pid}/document").json()["revision"]
    first = _save(client, headers, pid, empty, '<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttp="http://www.w3.org/ns/ttml#parameter" ttp:timeBase="media"><body timeContainer="par"><p begin="0s" end="1s">hello</p></body></tt>')
    created = client.post(f"/api/v1/projects/{pid}/publish", json={"revision": first, "asset_id": asset, "lrc_kind":"lrc", "lrc_text":"[00:00.000]hello\n[00:01.000]\n"}, headers={**headers, "idempotency-key": "pub-1"})
    assert created.status_code == 202
    retry = client.post(f"/api/v1/projects/{pid}/publish", json={"revision": first, "asset_id": asset, "lrc_kind":"lrc", "lrc_text":"[00:00.000]hello\n[00:01.000]\n"}, headers={**headers, "idempotency-key": "pub-1"})
    assert retry.status_code == 202 and retry.json()["id"] == created.json()["id"]
    done = _wait(client, created.json()["id"])
    assert done["status"] == "succeeded"
    second = _save(client, headers, pid, first, '<tt xmlns="http://www.w3.org/ns/ttml"><body><p begin="0s" end="1s">updated</p></body></tt>')
    assert second != first
    retry = client.post(f"/api/v1/projects/{pid}/publish", json={"revision":first,"asset_id":asset,"lrc_kind":"lrc","lrc_text":"[00:00.000]hello\n[00:01.000]\n"},headers={**headers,"idempotency-key":"pub-1"})
    assert retry.status_code == 202 and retry.json()['id'] == created.json()['id']
    exports = client.get(f"/api/v1/projects/{pid}/exports").json()["items"]
    assert exports[0]["report"]["passed"] is True
    assert exports[0]["stale"] is True
    restarted = TestClient(create_app(tmp_path, settings), base_url="https://studio")
    restarted.cookies.update(client.cookies)
    assert restarted.get(f"/api/v1/projects/{pid}/exports").json()["items"][0]["id"] == done["id"]
    download = client.get(f"/api/v1/projects/{pid}/exports/{done['id']}/download")
    assert download.status_code == 200 and (b"ftyp" in download.content[:32])
    path = next((tmp_path / "projects" / pid / "exports").glob("*"))
    path.unlink()
    assert client.get(f"/api/v1/projects/{pid}/exports").json()["items"][0]["status"] == "unavailable"
    assert client.get(f"/api/v1/projects/{pid}/exports/{done['id']}/download").status_code == 410


def test_publish_http_validation_and_download_auth_gate(tmp_path):
    settings = Settings("pw", False, "http://studio")
    client = TestClient(create_app(tmp_path, settings), base_url="https://studio")
    headers = _headers(client, settings)
    pid, asset = _project(client, headers, tmp_path)
    revision = client.get(f"/api/v1/projects/{pid}/document").json()["revision"]
    bad = _save(client, headers, pid, revision, '<tt xmlns="http://www.w3.org/ns/ttml" xmlns:studio="urn:lazulite:studio:draft"><body><p begin="0s" end="1s"><span studio:null="begin end">x</span></p></body></tt>')
    assert client.post(f"/api/v1/projects/{pid}/publish", json={"revision": bad, "asset_id": asset, "lrc_kind":"lrc", "lrc_text":"[00:00.000]hello\n[00:01.000]\n"}, headers={**headers, "idempotency-key": "bad"}).status_code == 202
    failed = _wait(client, client.get(f"/api/v1/projects/{pid}/exports").json()["items"][0]["id"])
    assert failed["status"] == "succeeded" and failed["error"] is None
    assert client.get(f"/api/v1/projects/{pid}/exports/{failed['id']}/download").status_code == 200
    unauthenticated = TestClient(create_app(tmp_path, settings), base_url="https://studio")
    assert unauthenticated.get(f"/api/v1/projects/{pid}/exports/{failed['id']}/download").status_code == 401
    assert client.post(f"/api/v1/projects/{pid}/publish", json={"revision": "missing", "asset_id": asset, "lrc_kind":"lrc", "lrc_text":"[00:00.000]hello\n[00:01.000]\n"}, headers=headers).status_code == 409
    assert client.post(f"/api/v1/projects/{pid}/publish", json={"revision": bad, "asset_id": "other"}, headers=headers).status_code == 422
    clock = _save(client, headers, pid, bad, '<tt xmlns="http://www.w3.org/ns/ttml"><body><p begin="0s" end="1s" dur="1s">x</p></body></tt>')
    clock_job = client.post(f"/api/v1/projects/{pid}/publish", json={"revision": clock, "asset_id": asset, "lrc_kind":"lrc", "lrc_text":"[00:00.000]hello\n[00:01.000]\n"}, headers={**headers, "idempotency-key": "clock"}).json()["id"]
    assert _wait(client, clock_job)["status"] == "succeeded"


def test_packaging_options_are_part_of_job_identity_and_output(tmp_path):
    from io import BytesIO
    from mutagen.mp4 import MP4
    settings = Settings("pw", False, "http://studio")
    with TestClient(create_app(tmp_path, settings), base_url="https://studio") as client:
        headers = _headers(client, settings)
        pid, asset = _project(client, headers, tmp_path)
        initial = client.get(f"/api/v1/projects/{pid}/document").json()["revision"]
        revision = _save(client, headers, pid, initial, '<tt xmlns="http://www.w3.org/ns/ttml"><body><p begin="0s" end="1s">hello</p></body></tt>')
        ordinary = {"revision":revision, "asset_id":asset, "lrc_kind":"lrc", "lrc_text":"[00:00.000]hello\n[00:01.000]\n"}
        extended = {**ordinary, "lrc_kind":"elrc", "lrc_text":"[00:00.000]hello<00:01.000>\n[00:01.000]\n"}
        url = f"/api/v1/projects/{pid}/publish"
        first = client.post(url,json=ordinary,headers={**headers,"idempotency-key":"options"}).json()
        assert client.post(url,json=extended,headers={**headers,"idempotency-key":"options"}).status_code == 409
        assert _wait(client,first['id'])['status']=='succeeded'
        response=client.get(f"/api/v1/projects/{pid}/exports/{first['id']}/download")
        assert MP4(BytesIO(response.content))["\xa9lyr"]==[ordinary['lrc_text']]
        second=client.post(url,json=extended,headers={**headers,"idempotency-key":"extended"}).json()
        assert first['id']!=second['id']
        assert _wait(client,second['id'])['status']=='succeeded'
        response=client.get(f"/api/v1/projects/{pid}/exports/{second['id']}/download")
        assert MP4(BytesIO(response.content))["\xa9lyr"]==[extended['lrc_text']]
        assert client.get(f"/api/v1/projects/{pid}/exports/{first['id']}/download").status_code==410
        assert client.post(url,json={**extended,"lrc_kind":"lrc"},headers=headers).status_code == 422
        assert client.post(url,json={**ordinary,"asset_id":"other"},headers=headers).status_code == 422


def test_publish_untimed_transliteration_whitespace_copy_and_missing_endpoint(tmp_path):
    from pathlib import Path
    import xml.etree.ElementTree as ET
    from server.publishing import extract_stpp
    settings = Settings('pw', False, 'http://studio')
    with TestClient(create_app(tmp_path, settings), base_url='https://studio') as client:
        headers = _headers(client, settings); pid, asset = _project(client, headers, tmp_path)
        initial = client.get(f'/api/v1/projects/{pid}/document').json()['revision']
        xml = '''<tt xmlns="http://www.w3.org/ns/ttml" xmlns:studio="urn:lazulite:studio:draft"><head><metadata><iTunesMetadata xmlns="http://music.apple.com/lyric-ttml-internal"><transliterations><transliteration xml:lang="ja-Latn"><text for="L1"><span begin="0s" end="0.4s">a</span><span studio:null="begin end">  </span><span begin="0.4s" end="1s"> </span></text></transliteration></transliterations></iTunesMetadata></metadata></head><body><p xml:id="L1" begin="0s" end="1s">hello</p></body></tt>'''
        revision = _save(client, headers, pid, initial, xml)
        body = {'revision': revision, 'asset_id': asset, 'lrc_kind': 'lrc', 'lrc_text': '[00:00.000]hello\n[00:01.000]\n'}
        job = client.post(f'/api/v1/projects/{pid}/publish', json=body, headers=headers).json()['id']
        assert _wait(client, job)['status'] == 'succeeded'
        source = client.get(f'/api/v1/projects/{pid}/document').json()['document']['lyrics']['draftTtml']
        assert source == normalize_ttml(xml)
        from server.db import Database
        with Database(tmp_path / 'studio.sqlite3').connect() as c:
            import json
            result = json.loads(c.execute('SELECT result_json FROM jobs WHERE id=?', (job,)).fetchone()[0])
        pure = extract_stpp(tmp_path / result['output_path'])
        root = ET.fromstring(pure)
        text = root.find('.//{http://music.apple.com/lyric-ttml-internal}text')
        assert ''.join(text.itertext()) == 'a   ' and len(list(text)) == 2
        assert all(not k.startswith('{urn:lazulite:studio:draft}') for element in root.iter() for k in element.attrib)
        for invalid in (xml.replace('studio:null="begin end">  ', 'studio:null="end" begin="0.4s">  '), xml.replace('studio:null="begin end">  ', 'studio:null="begin end">real')):
            bad = _save(client, headers, pid, revision, invalid); revision = bad
            job = client.post(f'/api/v1/projects/{pid}/publish', json={**body, 'revision': bad}, headers=headers).json()['id']
            assert _wait(client, job)['status'] == 'failed'
            assert client.get(f'/api/v1/projects/{pid}/exports/{job}/download').status_code == 409


def test_running_publish_cancel_removes_output_blocks_delete_until_worker_finishes(tmp_path):
    import threading
    from server.publish import MediaPublisher
    class BlockingPublisher(MediaPublisher):
        def __init__(self): self.started = threading.Event(); self.release = threading.Event()
        def publish(self, *args):
            self.started.set(); assert self.release.wait(5)
            return super().publish(*args)
    publisher = BlockingPublisher()
    settings = Settings('pw', False, 'http://studio')
    with TestClient(create_app(tmp_path, settings, publisher=publisher), base_url='https://studio') as client:
        headers = _headers(client, settings);pid, asset = _project(client, headers, tmp_path)
        initial = client.get(f'/api/v1/projects/{pid}/document').json()['revision']
        revision = _save(client, headers, pid, initial, '<tt xmlns="http://www.w3.org/ns/ttml"><body><p begin="0" end="1">test</p></body></tt>')
        body = {'revision': revision, 'asset_id': asset, 'lrc_kind': 'lrc', 'lrc_text': '[00:00.000]test\n'}
        job = client.post(f'/api/v1/projects/{pid}/publish', json=body, headers=headers).json()['id']
        assert publisher.started.wait(2)
        assert client.post(f'/api/v1/jobs/{job}/cancel', headers=headers).json()['status'] == 'cancel_requested'
        assert client.delete(f'/api/v1/projects/{pid}', headers=headers).status_code == 409
        publisher.release.set()
        assert _wait(client, job)['status'] == 'cancelled'
        exports = client.get(f'/api/v1/projects/{pid}/exports').json()['items']
        assert exports[0]['download_url'] is None and not list((tmp_path / 'projects' / pid / 'exports').iterdir())
        assert client.get(f'/api/v1/projects/{pid}/exports/{job}/download').status_code == 409
        assert client.delete(f'/api/v1/projects/{pid}', headers=headers).status_code == 200


import pytest
@pytest.mark.parametrize('kind,codec', [('mp3','libmp3lame'),('flac','flac'),('m4a','aac')])
def test_actual_format_controls_output_suffix_and_bound_history(tmp_path, kind, codec):
    settings = Settings('pw', False, 'http://studio')
    audio = tmp_path / f'source.{kind}'
    subprocess.run(['ffmpeg','-v','error','-f','lavfi','-i','sine=frequency=440:duration=1','-c:a',codec,str(audio)],check=True)
    with TestClient(create_app(tmp_path / 'data', settings), base_url='https://studio') as client:
        headers = _headers(client, settings)
        asset = client.post('/api/v1/uploads', files={'file': ('misleading.flac' if kind != 'flac' else 'misleading.mp3',audio.read_bytes(),'audio/mpeg')}, headers=headers).json()
        pid = client.post('/api/v1/projects', json={'name':'different project name','upload_id':asset['id']}, headers=headers).json()['id']
        info = client.get(f'/api/v1/projects/{pid}/packaging').json()
        assert info['container'] == ('mp4' if kind == 'm4a' else kind)
        assert info['extension'] == f'.{kind}'
        initial = client.get(f'/api/v1/projects/{pid}/document').json()['revision']
        # MP3/FLAC only write LRC and must not validate these unwritten transliterations.
        side = '' if kind == 'm4a' else '<head><metadata><iTunesMetadata xmlns="http://music.apple.com/lyric-ttml-internal"><transliterations><transliteration><text for="L1"><span xmlns:studio="urn:lazulite:studio:draft" studio:null="begin end">unfinished</span></text></transliteration></transliterations></iTunesMetadata></metadata></head>'
        revision = _save(client,headers,pid,initial,f'<tt xmlns="http://www.w3.org/ns/ttml">{side}<body><p xml:id="L1" begin="0" end="1">hello</p></body></tt>')
        body = {'revision':revision,'asset_id':asset['id'],'lrc_kind':'lrc','lrc_text':'[00:00.000]hello\n[00:01.000]\n'}
        job = client.post(f'/api/v1/projects/{pid}/publish', json=body,headers=headers).json()['id']
        assert _wait(client,job)['status'] == 'succeeded'
        item = client.get(f'/api/v1/projects/{pid}/exports').json()['items'][0]
        assert item['container'] == info['container'] and item['format_label'] == info['format_label']
        assert item['asset_id'] == asset['id'] and item['asset_filename'] == info['filename']
        assert item['filename'].endswith(f'.{kind}') and item['report']['lyrics_preserved'] is True
        assert bool(item['track_id']) == (kind == 'm4a')

@pytest.mark.parametrize('suffix', ['m4a', 'mp4'])
def test_cover_audio_preserves_suffix_and_project_download_history(tmp_path, suffix):
    from mutagen.mp4 import MP4, MP4Cover
    from urllib.parse import unquote
    source = tmp_path / 'covered.m4a'
    _m4a(source)
    cover = tmp_path / 'cover.png'
    subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=32x32', '-frames:v', '1', str(cover)], check=True)
    media = MP4(source); media['covr'] = [MP4Cover(cover.read_bytes(), imageformat=MP4Cover.FORMAT_PNG)]; media.save()
    settings = Settings('pw', False, 'http://studio')
    app = create_app(tmp_path / 'data', settings)
    with TestClient(app, base_url='https://studio') as client:
        headers = _headers(client, settings)
        asset = client.post('/api/v1/uploads', files={'file': (f'原音频.{suffix}', source.read_bytes(), 'audio/mp4')}, headers=headers).json()
        pid = client.post('/api/v1/projects', json={'name': '中文 日本語:/曲?', 'upload_id': asset['id']}, headers=headers).json()['id']
        info = client.get(f'/api/v1/projects/{pid}/packaging').json()
        assert info['extension'] == f'.{suffix}'
        assert info['format_label'] == 'M4A（MP4 容器）'
        revision = client.get(f'/api/v1/projects/{pid}/document').json()['revision']
        revision = _save(client, headers, pid, revision, '<tt xmlns="http://www.w3.org/ns/ttml"><body><p begin="0" end="1">hello</p></body></tt>')
        body = {'revision': revision, 'asset_id': asset['id'], 'lrc_kind': 'lrc', 'lrc_text': '[00:00.000]hello\n[00:01.000]\n'}
        for _ in range(2):
            job = client.post(f'/api/v1/projects/{pid}/publish', json=body, headers=headers).json()['id']
            assert _wait(client, job)['status'] == 'succeeded'
        items = client.get(f'/api/v1/projects/{pid}/exports').json()['items']
        assert len(items) == 2
        assert len(list((tmp_path / 'data' / 'projects' / pid / 'exports').iterdir())) == 1
        assert items[1]['download_url'] is None
        for item in items[:1]:
            assert item['filename'] == f'中文 日本語__曲_.{suffix}'
            response = client.get(item['download_url'])
            assert response.status_code == 200
            assert item['filename'] in unquote(response.headers['content-disposition'])
            output = tmp_path / f'download.{suffix}'; output.write_bytes(response.content)
            assert MP4(output)['covr'][0] == cover.read_bytes()
            assert item['report']['passed'] is True


def test_video_classification_and_portable_download_names(tmp_path):
    from mutagen import File
    from server.media_format import describe_media, download_filename
    source = tmp_path / 'video.mp4'
    subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=32x32:d=1', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:v', 'mpeg4', '-c:a', 'aac', '-shortest', str(source)], check=True)
    assert describe_media(source, File(source), 'wrong.m4a')['extension'] == '.mp4'
    assert describe_media(source, File(source), 'video.mp4')['format_label'] == 'MP4'
    assert download_filename('CON', '.mp3') == '_CON.mp3'
    assert download_filename(' . ', '.flac') == '未命名项目.flac'
    assert len(download_filename('歌' * 200, '.mp4').encode()) < 255


def test_translation_publication_never_flattens_unknown_timing(tmp_path):
    from pathlib import Path
    from server.publish import validate_output_ttml, PublishInvalid
    import pytest
    source = Path(__file__).resolve().parents[2] / 'tests/fixtures/ttml/timeline-translation-external.ttml'
    xml = source.read_text(encoding='utf-8')
    assert validate_output_ttml(xml, xml=True)['passed']
    for invalid in [xml.replace('begin="500ms"', '', 1), xml.replace('type="replacement"', 'type="other"', 1)]:
        with pytest.raises(PublishInvalid):
            validate_output_ttml(invalid, xml=True)


def test_stpp_optional_timing_preserves_source_tags_without_lrc(tmp_path):
    from mutagen.mp4 import MP4
    from server.publishing import extract_stpp
    import xml.etree.ElementTree as ET
    source = tmp_path / 'source.m4a'
    _m4a(source)
    tags = MP4(source); tags['\xa9lyr'] = ['original lyrics']; tags['\xa9nam'] = ['title']; tags.save()
    settings = Settings('pw', False, 'http://studio')
    with TestClient(create_app(tmp_path / 'data', settings), base_url='https://studio') as client:
        headers = _headers(client, settings)
        asset = client.post('/api/v1/uploads', files={'file': ('source.m4a', source.read_bytes(), 'audio/mp4')}, headers=headers).json()['id']
        pid = client.post('/api/v1/projects', json={'name': 'optional timing', 'upload_id': asset}, headers=headers).json()['id']
        revision = client.get(f'/api/v1/projects/{pid}/document').json()['revision']
        xml = '''<tt xmlns="http://www.w3.org/ns/ttml" xmlns:tts="http://www.w3.org/ns/ttml#styling" xmlns:studio="urn:lazulite:studio:draft"><body><p studio:null="begin end"><span studio:null="begin">untimed</span><span begin="0.2s">partial</span><span tts:ruby="container"><span tts:ruby="base">字</span><span tts:ruby="text"><span end="2s">じ</span></span></span></p><p begin="0s" end="2s"/><p begin="0s" end="0s"/></body></tt>'''
        revision = _save(client, headers, pid, revision, xml)
        body = {'revision': revision, 'asset_id': asset, 'lrc_kind': 'none', 'lrc_text': None}
        url = f'/api/v1/projects/{pid}/publish'
        for invalid in ({**body, 'lrc_text': ''}, {**body, 'lrc_kind': 'lrc'}):
            assert client.post(url, json=invalid, headers=headers).status_code == 422
        job = client.post(url, json=body, headers=headers).json()['id']
        assert _wait(client, job)['status'] == 'succeeded'
        item = client.get(f'/api/v1/projects/{pid}/exports').json()['items'][0]
        output = tmp_path / 'output.m4a'; output.write_bytes(client.get(item['download_url']).content)
        assert MP4(output)['\xa9lyr'] == ['original lyrics']
        assert MP4(output)['\xa9nam'] == ['title']
        root = ET.fromstring(extract_stpp(output)); ns = '{http://www.w3.org/ns/ttml}'
        lines = root.findall(f'.//{ns}p')
        assert len(lines) == 3 and lines[0].get('begin') is None and lines[0].get('end') is None
        spans = lines[0].findall(f'{ns}span')
        assert spans[0].get('begin') is None and spans[0].get('end') is None
        assert spans[1].get('begin') == '00:00.200' and spans[1].get('end') is None
        assert 'untimedpartial字じ' == ''.join(lines[0].itertext())
        assert all(not key.startswith('{urn:lazulite:studio:draft}') for node in root.iter() for key in node.attrib)
        assert item['report']['audio_preserved'] and item['report']['metadata_preserved']


def test_output_copy_keeps_semantic_whitespace_and_projects_unicode_separators():
    from server.publish import serialize_output_ttml
    import xml.etree.ElementTree as ET
    xml = '''<tt xmlns="http://www.w3.org/ns/ttml" xmlns:studio="urn:lazulite:studio:draft" xmlns:amll="http://www.example.com/ns/amll" xmlns:tts="http://www.w3.org/ns/ttml#styling"><head><metadata><iTunesMetadata xmlns="http://music.apple.com/lyric-ttml-internal"><transliterations><transliteration><text for="L1" studio:kind="timed"><span begin="0" end="1">a</span><span>　</span></text><text for="L1" studio:kind="timed"><span>　</span></text></transliteration></transliterations></iTunesMetadata></metadata></head><body><p xml:id="L1"><span>　</span><span studio:id="beat"> </span><span amll:obscene="true"> </span><span tts:ruby="base"> </span></p></body></tt>'''
    snapshot = initial_project(xml, None)
    snapshot['editing']['emptyBeats'] = {'beat': {'kind': 'word', 'count': 1}}
    root = ET.fromstring(serialize_output_ttml(snapshot))
    line = root.find('.//{http://www.w3.org/ns/ttml}p')
    assert line.text == '　' and len(line) == 3
    content = root.findall('.//{http://music.apple.com/lyric-ttml-internal}text')
    assert len(content[0]) == 1 and content[0][0].tail == '　'
    assert len(content[1]) == 1 and content[1][0].text == '　'
