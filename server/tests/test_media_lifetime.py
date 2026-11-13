import uuid
from server.studio.media_lifetime import MediaLifetime
from server.tests.test_vocals import setup


def test_pages_expiry_and_requests_share_until_last_release(tmp_path):
    now = [0]
    lifetime = MediaLifetime(tmp_path, clock=lambda: now[0], ttl=180)
    lifetime.heartbeat('p', 'one'); lifetime.heartbeat('p', 'two')
    media, release = lifetime.retain('p')
    other, finish = lifetime.retain('p')
    assert media is other
    lifetime.leave('p', 'one')
    lifetime.heartbeat('p', 'one')  # in-flight renewal after unmount
    assert 'one' not in lifetime.entries['p'].pages
    now[0] = 181
    lifetime.sweep()
    assert 'p' in lifetime.entries
    release(); release()
    assert 'p' in lifetime.entries
    finish()
    assert not lifetime.entries


def test_http_ranges_windows_restart_and_page_lifetime(tmp_path):
    client, _ = setup(tmp_path)
    with client:
        registry = client.app.state.media_lifetime
        token = str(uuid.uuid4()); url = f'/api/v1/projects/p/media-users/{token}'
        assert client.put(url, headers={'origin': 'http://studio'}).status_code == 204
        full = client.get('/api/v1/projects/p/audio')
        assert full.status_code == 200 and full.content[:4] == b'RIFF'
        media = registry.entries['p'].media
        resource = next(iter(media._resources.values()))
        for bounds, expected in [('bytes=0-99', full.content[:100]), ('bytes=-50', full.content[-50:]), ('bytes=44-', full.content[44:])]:
            response = client.get('/api/v1/projects/p/audio', headers={'range': bounds})
            assert response.status_code == 206 and response.content == expected
        assert client.get('/api/v1/projects/p/audio', headers={'range': 'bytes=99999999-'}).status_code == 416
        assert client.get('/api/v1/projects/p/audio', headers={'range': 'bytes=0-99', 'if-range': 'stale'}).content == full.content
        pcm = client.get('/api/v1/projects/p/pcm?start_ms=0&end_ms=1000')
        assert pcm.content == resource.pcm[:48000 * 4]
        assert client.get('/api/v1/projects/p/waveform?end_ms=1000').status_code == 200
        assert next(iter(media._resources.values())) is resource
        assert client.delete(url, headers={'origin': 'http://studio'}).status_code == 204
        assert not registry.entries and not media._resources
        assert client.get('/api/v1/projects/p/audio').content == full.content
        assert not registry.entries
    assert not list((tmp_path/'projects/p/cache').glob('*'))


def test_disconnected_stream_releases_request_even_when_send_raises(tmp_path):
    import asyncio
    import pytest
    from server.project_resources import stream_memory
    from server.studio.media import Proxy
    registry = MediaLifetime(tmp_path)
    _, release = registry.retain('p')
    proxy = Proxy(b'\0' * 4000, 48000, 2, 0, 1000)
    response = stream_memory(proxy, '"test"', release=release)
    async def receive(): await asyncio.Event().wait()
    async def send(message):
        assert registry.entries['p'].requests == 1
        if message['type'] == 'http.response.body': raise OSError('disconnected')
    with pytest.raises(Exception):
        asyncio.run(response({'type':'http','asgi':{'spec_version':'2.4'}},receive,send))
    assert not registry.entries


def test_startup_reclaims_only_disposable_derivatives(tmp_path):
    from fastapi.testclient import TestClient
    from server.app import create_app
    from server.auth import Settings
    client, _ = setup(tmp_path)
    with client:
        source = (tmp_path/'projects/p/source/original').read_bytes()
    cache = tmp_path/'projects/p/cache'
    (cache/'source-hash.wav').write_bytes(b'proxy')
    peaks = cache/'source-hash.peaks-v1'; peaks.mkdir(); (peaks/'l0.peaks').write_bytes(b'peaks')
    (cache/'other').write_bytes(b'keep')
    with TestClient(create_app(tmp_path, Settings(None, True))) as restarted:
        assert (tmp_path/'projects/p/source/original').read_bytes() == source
        assert [p.name for p in cache.iterdir()] == ['other']
        assert restarted.get('/api/v1/projects/p/audio').status_code == 200
