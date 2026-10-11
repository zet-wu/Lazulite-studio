import pytest
from fastapi.testclient import TestClient
from server.auth import Settings, normalize_origin
from server.app import create_app


@pytest.mark.parametrize('value,expected', [('HTTP://LOCALHOST:80','http://localhost'),('https://Example.COM:443','https://example.com'),('http://127.0.0.1:15173','http://127.0.0.1:15173'),('http://[0:0:0:0:0:0:0:1]:15173','http://[::1]:15173')])
def test_normalize_browser_origin(value,expected):
 assert normalize_origin(value)==expected
 assert Settings(origin=value).origin==expected


@pytest.mark.parametrize('value', ['', 'null', 'file://a', 'http://u:p@host', 'http://host/', 'http://host/path', 'http://host?', 'http://host#', 'http://host:0', 'http://host:65536', 'http://host:', 'http://a b', 'http://a\\b', 'http://a,http://b', 'http://127.1', 'http://[fe80::1%25eth0]', 'http://host\n'])
def test_invalid_origin(value):
 with pytest.raises(ValueError): normalize_origin(value)


@pytest.mark.parametrize('origin',['http://127.0.0.1:5173','http://127.0.0.1:15173','http://localhost:15173'])
def test_exact_origin_login_password_csrf_and_write(tmp_path,origin):
 with TestClient(create_app(tmp_path,Settings('pw',False,origin))) as client:
  for headers in ({},{'origin':'http://127.0.0.1:9999'}):
   response=client.post('/api/v1/session',json={'password':'pw'},headers=headers)
   assert response.status_code==403 and response.json()['code']=='origin_forbidden'
   assert '访问地址' in response.json()['message']
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
  for bad in ({**good,'origin':'http://127.0.0.1:9999'},{k:v for k,v in good.items() if k!='origin'}):
   assert client.put(f'/api/v1/projects/{pid}/document',json=body,headers=bad).status_code==403
  reply=client.put(f'/api/v1/projects/{pid}/document',json=body,headers=good)
  assert reply.status_code==200,reply.text
