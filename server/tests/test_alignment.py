import os,time
from server.tests.test_vocals import setup,wait
from server.project_document import initial_project
from server.revisions import RevisionStore


def prepare(tmp_path,monkeypatch):
 from server import vocal_process,alignment
 monkeypatch.setattr(alignment,'alignment_unavailable',lambda:None)
 original=vocal_process.subprocess.Popen
 def spawn(args,**kwargs):
  if args[-1]=='server.alignment_worker':args=[*args[:-1],'server.tests.alignment_worker_fixture']
  return original(args,**kwargs)
 monkeypatch.setattr(vocal_process.subprocess,'Popen',spawn)
 client,db=setup(tmp_path,factory=None)
 with db.connect() as c:row=c.execute("SELECT current_revision FROM projects WHERE id='p'").fetchone()
 snapshot=initial_project('<tt xmlns="http://www.w3.org/ns/ttml" xmlns:studio="urn:lazulite:studio:draft"><body><p xml:id="l" studio:null="begin end"><span studio:id="w" studio:null="begin end">あlove漢字</span></p></body></tt>',None)
 revision=RevisionStore(db,tmp_path/'projects').create('p',snapshot,row[0])['id']
 return client,db,revision


def test_preview_launch_isolation_idempotency_and_audio_mutex(tmp_path,monkeypatch):
 client,db,revision=prepare(tmp_path,monkeypatch)
 with client:
  preview=client.get('/api/v1/projects/p/alignment-preview',params={'revision':revision}).json()
  assert preview['unknown_count']==1 and preview['hint_count']==0 and preview['emitting_count']==2
  headers={'origin':'http://studio','idempotency-key':'launch'};body={'params':{'revision':revision,'use_hints':False,'line_blank':False,'rest_blank':False,'rest_token':False,'clear_unmatched':False}}
  first=client.post('/api/v1/projects/p/jobs/alignment',json=body,headers=headers)
  assert first.status_code==202,first.text
  jid=first.json()['id']
  assert client.post('/api/v1/projects/p/jobs/alignment',json=body,headers=headers).json()['id']==jid
  asset=client.get('/api/v1/projects/p').json()['asset']['id']
  assert client.post('/api/v1/projects/p/jobs/vocal',json={'params':{'asset_id':asset}},headers={'origin':'http://studio'}).status_code==409
  start=time.monotonic();assert client.get('/api/v1/session').status_code==200;assert time.monotonic()-start<.5
  assert wait(client,jid)['status']=='succeeded'
  result=client.get(f'/api/v1/jobs/{jid}/result').json()
  assert result['binding']['revision']==revision and result['engine']['worker_pid']!=os.getpid()
  assert client.get('/api/v1/projects/p/document').json()['revision']==revision
  assert client.post('/api/v1/projects/p/jobs/alignment',json={'params':{'revision':revision,'use_hints':False,'line_blank':False,'rest_blank':False,'rest_token':False,'clear_unmatched':False,'model_path':'/tmp/evil'}},headers={'origin':'http://studio'}).status_code==422


def test_cancellation_does_not_publish_and_removed_routes_fail(tmp_path,monkeypatch):
 client,db,revision=prepare(tmp_path,monkeypatch)
 with client:
  headers={'origin':'http://studio'}
  jid=client.post('/api/v1/projects/p/jobs/alignment',json={'params':{'revision':revision,'use_hints':True,'line_blank':False,'rest_blank':False,'rest_token':False,'clear_unmatched':False}},headers=headers).json()['id']
  client.post(f'/api/v1/jobs/{jid}/cancel',headers=headers)
  assert wait(client,jid)['status']=='cancelled'
  assert client.get(f'/api/v1/jobs/{jid}/result').status_code==409
  assert client.get('/api/v1/projects/p/document').json()['revision']==revision
  for kind in ['align','transcribe','reading','forced_align','search','fetch']:
   assert client.post(f'/api/v1/projects/p/jobs/{kind}',json={'params':{}},headers=headers).status_code==422
  for path in ['reading-dictionary','review']:
   assert client.get(f'/api/v1/projects/p/{path}').status_code==404
  assert client.get('/api/v1/projects/p/alignment-preview',params={'revision':'stale'}).status_code==409


def test_all_cost_combinations_are_snapshotted_and_strict(tmp_path,monkeypatch):
 import itertools
 client,db,revision=prepare(tmp_path,monkeypatch)
 with client:
  for flags in itertools.product([False,True],repeat=3):
   params={'revision':revision,'use_hints':False,'clear_unmatched':False,**dict(zip(('line_blank','rest_blank','rest_token'),flags))}
   reply=client.post('/api/v1/projects/p/jobs/alignment',json={'params':params},headers={'origin':'http://studio'})
   assert reply.status_code==202,reply.text
   jid=reply.json()['id'];assert wait(client,jid)['status']=='succeeded'
   actual=client.get(f'/api/v1/jobs/{jid}/result').json()['engine']['params']
   assert all(actual[k]==v for k,v in params.items())
  for value in (0,1,'true',None):
   params['rest_token']=value
   assert client.post('/api/v1/projects/p/jobs/alignment',json={'params':params},headers={'origin':'http://studio'}).status_code==422
