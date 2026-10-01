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
