import xml.etree.ElementTree as ET
import pytest
from fastapi.testclient import TestClient
from server.app import create_app
from server.auth import Settings
from server.documents import validate_ttml
from server.project_document import initial_project
from server.tests.test_documents import setup_project

SOURCE = '''<tt xmlns="http://www.w3.org/ns/ttml" xmlns:tts="http://www.w3.org/ns/ttml#styling" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" xmlns:amll="http://www.example.com/ns/amll" xmlns:studio="urn:lazulite:studio:draft"><body><p xml:id="a" begin="0" end="5"><span studio:id="w" ttm:role="expletive" amll:obscene="true" begin="0" end="1">Alpha</span><span studio:id="rw" tts:ruby="container" ttm:role="expletive" amll:obscene="true" begin="1" end="2"><span tts:ruby="base">今日</span><span tts:ruby="textContainer"><span tts:ruby="text" studio:id="r" begin="1" end="2">きょう</span></span></span><span ttm:role="x-bg" studio:id="bg" begin="0" end="2"><span studio:id="bw" ttm:role="expletive" amll:obscene="true" begin="0" end="2">背景</span></span></p></body></tt>'''

def test_flags_survive_service_save_and_reopen(tmp_path):
    setup_project(tmp_path)
    client = TestClient(create_app(tmp_path, Settings(None, True, 'http://studio')), base_url='https://studio')
    before = client.get('/api/v1/projects/p/document')
    saved = client.put('/api/v1/projects/p/document', json={'schema_version': 'studio-document-v8', 'project_id': 'p', 'revision': before.json()['revision'], 'document': initial_project(SOURCE, None)}, headers={'origin': 'http://studio', 'if-match': before.headers['etag']})
    assert saved.status_code == 200, saved.text
    reopened = client.get('/api/v1/projects/p/document').json()
    root = ET.fromstring(reopened['document']['lyrics']['draftTtml'])
    flagged = [e for e in root.iter() if e.get('{http://www.example.com/ns/amll}obscene') == 'true']
    assert len(flagged) == 3
    assert [e.get('{urn:lazulite:studio:draft}id') for e in flagged] == ['w', 'rw', 'bw']
    assert list(flagged[0].itertext()) == ['Alpha']
    assert reopened['document']['editing'] == {'emptyBeats': {}, 'skippedAlignmentLineIds': [], 'ignoredSyncLineIds': [], 'endLinks': {}}

@pytest.mark.parametrize('source', [SOURCE.replace('obscene="true"', 'obscene="yes"', 1), SOURCE.replace('<p ', '<p amll:obscene="true" '), SOURCE.replace('tts:ruby="text"', 'tts:ruby="text" amll:obscene="true"'), SOURCE.replace('tts:ruby="base"', 'tts:ruby="base" amll:obscene="true"'), SOURCE.replace('ttm:role="x-bg"', 'ttm:role="x-bg" amll:obscene="true"')])
def test_invalid_flags_rejected(source):
    with pytest.raises(ValueError, match='amll:obscene'):
        validate_ttml(source)

@pytest.mark.parametrize('expression', ['ttm:role="expletive"', 'ttm:role=" expletive  expletive "', 'amll:obscene="true"', 'ttm:role="expletive" amll:obscene="true"'])
def test_standard_and_amll_expressions(expression):
    validate_ttml(SOURCE.replace('ttm:role="expletive" amll:obscene="true"', expression))

def test_contradictory_flags_rejected():
    with pytest.raises(ValueError, match='conflicts'):
        validate_ttml(SOURCE.replace('obscene="true"', 'obscene="false"', 1))
