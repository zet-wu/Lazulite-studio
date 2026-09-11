import xml.etree.ElementTree as ET

from server.review_fingerprint import fingerprint


def test_ancestor_timing_changes_fingerprint():
    before = ET.fromstring('<tt xmlns="http://www.w3.org/ns/ttml"><body><div begin="0s"><p xml:id="line">歌</p></div></body></tt>')
    after = ET.fromstring('<tt xmlns="http://www.w3.org/ns/ttml"><body><div begin="3s"><p xml:id="line">歌</p></div></body></tt>')
    assert fingerprint(before, "line") != fingerprint(after, "line")
