from fastapi.testclient import TestClient
from server.auth import Settings
from server.app import create_app

def test_password_csrf_and_document_write(tmp_path):
 origin="http://studio"
 with TestClient(create_app(tmp_path,Settings('pw', False))) as client:
  assert client.post('/api/v1/session',json={'password':'wrong'},headers={'origin':origin}).status_code==401
  response=client.post('/api/v1/session',json={'password':'pw'},headers={'origin':origin})
  assert response.status_code==200
  csrf=response.cookies['studio_csrf']
  # Project creation is a real write; anonymous/bad CSRF remains forbidden.
  assert client.post('/api/v1/projects',json={'name':'origin'},headers={'origin':origin}).status_code==403
  headers={'origin':origin,'x-csrf-token':csrf}
  reply=client.post('/api/v1/projects',json={'name':'origin'},headers=headers)
  assert reply.status_code==200,reply.text
  pid=reply.json()['id'];env=client.get(f'/api/v1/projects/{pid}/document').json()
  body={k:env[k] for k in ('schema_version','project_id','revision','document')}
  good={**headers,'if-match':env['revision']}
  reply=client.put(f'/api/v1/projects/{pid}/document',json=body,headers=good)
  assert reply.status_code==200,reply.text
