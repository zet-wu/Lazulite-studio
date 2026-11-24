import base64
import json
import zlib
import httpx
import pytest
from server.lyric_sources import Candidate, Sources, decode_krc, decode_qq, KRC_KEY, QRC_KEY
from server.vendor.qrc_des import ENCRYPT, tripledes_crypt, tripledes_key_setup


def test_transport_decoders_and_bounds():
    text = '[1000,1000]<0,1000,0>合成'
    compressed = zlib.compress(text.encode())
    raw = b'krc1'+bytes(v ^ KRC_KEY[i % 16] for i,v in enumerate(compressed))
    assert decode_krc(raw) == text
    with pytest.raises(ValueError): decode_krc(b'bad')
    qrc = '[1000,1000]合成(1000,1000)'
    compressed = zlib.compress(qrc.encode()); compressed += b'\0' * (-len(compressed) % 8)
    key = tripledes_key_setup(QRC_KEY, ENCRYPT)
    encrypted = b''.join(tripledes_crypt(bytearray(compressed[i:i+8]),key) for i in range(0,len(compressed),8))
    assert decode_qq(encrypted.hex()) == qrc
    assert decode_qq(base64.b64encode(qrc.encode()).decode()) == qrc


@pytest.mark.parametrize('source', ['netease','qqmusic','kugou','amll'])
def test_four_provider_transport_preserves_original_format(source):
    def respond(request):
        url = str(request.url)
        if source == 'netease': return httpx.Response(200,json={'code':200,'yrc':{'lyric':'[1000,500](1000,500,0)字'},'ytlrc':{'lyric':'[00:01]translation'}})
        if source == 'qqmusic': return httpx.Response(200,json={'code':0,'req_0':{'code':0,'data':{'lyric':'[1000,500]字(1000,500)','roma':'[1000,500]zi(1000,500)'}}})
        if source == 'amll': return httpx.Response(200,text='<tt>fixture</tt>')
        if '/search?' in url: return httpx.Response(200,json={'candidates':[{'id':'x','accesskey':'k','duration':500}]})
        compressed = zlib.compress(b'[1000,500]<0,500,0>word')
        content = base64.b64encode(b'krc1'+bytes(v ^ KRC_KEY[i%16] for i,v in enumerate(compressed))).decode()
        return httpx.Response(200,json={'fmt':'krc','content':content})
    service = Sources(httpx.MockTransport(respond))
    result = service.fetch(Candidate(source=source,id='123',songmid='songMid',songid='123',platform='ncm-lyrics',file='123.ttml'))
    assert result['format'] == {'netease':'yrc','qqmusic':'qrc','kugou':'krc','amll':'ttml'}[source]
    assert result['empty'] is False
    if source == 'qqmusic': assert result['metadata']['qqMusicId'] == ['songMid']


def test_upstream_failure_is_not_empty():
    s=Sources(httpx.MockTransport(lambda request: httpx.Response(429)))
    with pytest.raises(httpx.HTTPStatusError): s.search('netease','x')
    with pytest.raises(ValueError): Candidate(source='amll',id='x',file='../secret.ttml')

def test_qq_optional_decode_failure_keeps_body():
    service = Sources()
    service.request = lambda *args, **kwargs: {'code': 0, 'req_0': {'code': 0, 'data': {'lyric': '[1000,500]body(1000,500)', 'trans': 'badbase64', 'roma': '[00:01]roma'}}}
    payload = service.fetch(Candidate(source='qqmusic', id='1', songmid='mid', songid='1'))
    assert payload['format'] == 'qrc' and payload['content'] == '[1000,500]body(1000,500)'
    assert payload['partial'] is True and payload['romanization'] == '[00:01]roma'


def test_kugou_invalid_base64_is_a_decode_failure():
    from server.lyric_sources import SourceDecodeError
    service = Sources()
    service.request = lambda url, **kwargs: {'candidates': [{'id': '1', 'accesskey': 'key'}]} if '/search' in url else {'content': 'invalid!'}
    with pytest.raises(SourceDecodeError):
        service.fetch(Candidate(source='kugou', id='1'))

@pytest.mark.parametrize('fallback', [False, True])
def test_qq_search_returns_full_identifiers_without_detail_requests(fallback):
    seen = []
    def respond(request):
        seen.append(request)
        song = {'mid':'mid123','id':123,'name':'歌','singer':[{'name':'A'},{'name':'B'}],'album':{'name':'专辑'},'interval':187}
        if request.method == 'POST':
            body=json.loads(request.content)
            assert body['music.search.SearchCgiService']['param']['num_per_page'] == 30
            return httpx.Response(503) if fallback else httpx.Response(200,json={'code':0,'music.search.SearchCgiService':{'code':0,'data':{'body':{'song':{'list':[song]}}}}})
        assert request.url.path.endswith('search_for_qq_cp') and request.url.params['n']=='30'
        return httpx.Response(200,json={'code':0,'data':{'song':{'list':[song]}}})
    rows=Sources(httpx.MockTransport(respond)).search('qqmusic','歌 A')
    assert rows[0].songmid=='mid123' and rows[0].songid=='123' and rows[0].duration_ms==187000
    assert rows[0].artists==['A','B'] and rows[0].album=='专辑'
    assert len(seen)==(2 if fallback else 1)

@pytest.mark.parametrize('fallback', [False, True])
def test_kugou_search_uses_thirty_results_and_splits_multiple_singers(fallback):
    def respond(request):
        assert request.url.params['pagesize']=='30'
        if request.url.host=='mobiles.kugou.com':
            return httpx.Response(503) if fallback else httpx.Response(200,json={'status':1,'data':{'info':[{'hash':'hash','songname':'歌','singername':'A、B / C','duration':120}]}})
        assert request.url.host=='songsearch.kugou.com'
        return httpx.Response(200,json={'data':{'lists':[{'FileHash':'hash','SongName':'歌','SingerName':'A、B / C','Duration':120}]}})
    row=Sources(httpx.MockTransport(respond)).search('kugou','歌 A')[0]
    assert row.artists==['A','B','C'] and row.duration_ms==120000

def test_qq_empty_primary_does_not_retry_a_failed_legacy(monkeypatch):
    source = Sources()
    calls = []
    def request(url, **kwargs):
        calls.append(url)
        if 'musicu' in url: return {'code':0}
        raise httpx.ConnectError('offline')
    monkeypatch.setattr(source, 'request', request)
    with pytest.raises(httpx.HTTPError): source.search('qqmusic', '歌')
    assert len(calls) == 2


def test_upstream_null_albums_and_empty_mid_are_valid_search_payloads(monkeypatch):
    source = Sources()
    monkeypatch.setattr(source, 'request', lambda *args, **kwargs: {'result':{'songs':[{'id':1,'name':'歌','album':None}]}})
    assert source.search('netease','歌')[0].album == ''
    monkeypatch.setattr(source, 'request', lambda *args, **kwargs: {'music.search.SearchCgiService':{'data':{'body':{'song':{'list':[{'id':1,'mid':'','songmid':'','name':'歌','album':None}]}}}}})
    candidate = source.search('qqmusic','歌')[0]
    assert candidate.id == '1' and candidate.songmid is None
