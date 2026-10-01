import xml.etree.ElementTree as ET
import pytest
from server.time_units import milliseconds, normalize_ttml

@pytest.mark.parametrize('raw,expected', [('18.084263',18084),('18.084500',18085),('59.9995',60000),('3599.9995',3600000)])
def test_half_millisecond_and_clock_carries(raw,expected):
    assert milliseconds(raw)==expected
    normalized=normalize_ttml(f'<tt xmlns="http://www.w3.org/ns/ttml"><body><p begin="{raw}" end="3601">歌</p></body></tt>')
    assert normalize_ttml(normalized)==normalized
    from server.publish import _time
    p=ET.fromstring(normalized).find('.//{http://www.w3.org/ns/ttml}p')
    assert milliseconds(_time(p.get('begin')))==expected

def test_relative_round_once_and_original_inversion():
    normalized=normalize_ttml('<tt xmlns="http://www.w3.org/ns/ttml"><body><div begin="0.0004s"><p begin="0.0004s" end="0.0005s">歌</p></div></body></tt>')
    p=ET.fromstring(normalized).find('.//{http://www.w3.org/ns/ttml}p')
    assert p.get('begin')==p.get('end')=='00:00.001'
    with pytest.raises(ValueError): normalize_ttml('<tt><p begin="0.00049" end="0.00048"/></tt>')
