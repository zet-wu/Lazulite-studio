from pathlib import Path
from copy import deepcopy
import pytest
from fastapi.testclient import TestClient
from server.app import create_app
from server.auth import Settings
from server.project_document import initial_project
from server.amll_compatibility import validate_amll
from server.tests.test_documents import setup_project
XML=(Path(__file__).parents[2]/'tests/fixtures/ttml/amll-rich.ttml').read_text()

def project():
    value=initial_project(XML,None)
    value['amll'].update(noMultipleBackgrounds=False,noWordAgents=False)
    value['lineOrder']=['bg2','main','bg1','next']
    return value

@pytest.mark.parametrize('rule',['simplified','noMultipleBackgrounds','noChorus','noWordAgents','noIndependentBackground'])
def test_each_enabled_rule_rejects_current_conflicts(rule):
    value=project();value['amll'][rule]=True
    with pytest.raises(ValueError):validate_amll(value)

def test_real_service_preserves_settings_order_words_and_both_background_attachments(tmp_path):
    setup_project(tmp_path)
    with TestClient(create_app(tmp_path,Settings(None,True,'http://studio')),base_url='https://studio') as client:
        before=client.get('/api/v1/projects/p/document').json()
        body={**{key:before[key] for key in ('schema_version','project_id','revision')},'document':project()}
        response=client.put('/api/v1/projects/p/document',json=body,headers={'origin':'http://studio','if-match':before['revision']})
        assert response.status_code==200,response.text
        opened=client.get('/api/v1/projects/p/document').json()
        assert opened['document']['lineOrder']==['bg2','main','bg1','next']
        xml=opened['document']['lyrics']['draftTtml']
        assert all(text in xml for text in ['first translation','second translation','first roman','second roman','b a','expletive'])
        invalid=deepcopy(opened);invalid['document']['amll']['noWordAgents']=True
        response=client.put('/api/v1/projects/p/document',json={key:invalid[key] for key in ('schema_version','project_id','revision','document')},headers={'origin':'http://studio','if-match':opened['revision']})
        assert response.status_code==422,response.text
        assert client.get('/api/v1/projects/p/document').json()==opened

def test_order_and_stable_anonymous_sides_validate():
    value=project();value['lineOrder']=['missing']
    with pytest.raises(ValueError):validate_amll(value)
    value=initial_project('<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata"><head><metadata><ttm:agent xml:id="v2" type="person"/></metadata></head><body><p xml:id="main" ttm:agent="v2">text</p></body></tt>',None)
    value['amll'].update(simplified=True,noChorus=True,noIndependentBackground=True)
    validate_amll(value)
