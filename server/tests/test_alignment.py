import os,time
from server.tests.test_vocals import setup
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
 from server.tests.test_alignment_models import model
 models=tmp_path/'models';model(models)
 monkeypatch.setenv('STUDIO_ALIGNMENT_MODELS_DIR',str(models))
 client,db=setup(tmp_path,factory=None)
 with db.connect() as c:row=c.execute("SELECT current_revision FROM projects WHERE id='p'").fetchone()
 snapshot=initial_project('<tt xmlns="http://www.w3.org/ns/ttml" xmlns:studio="urn:lazulite:studio:draft"><body><p xml:id="l" studio:null="begin end"><span studio:id="w" studio:null="begin end">あlove漢字</span></p></body></tt>')
 revision=RevisionStore(db,tmp_path/'projects').create('p',snapshot,row[0])['id']
 return client,db,revision


def test_preview_launch_isolation_idempotency_and_audio_mutex(tmp_path,monkeypatch):
 client,db,revision=prepare(tmp_path,monkeypatch)
 with client:
  preview=client.get('/api/v1/projects/p/alignment-preview',params={'revision':revision,'model':client.get('/api/v1/alignment-models').json()['items'][0]['id']}).json()
  assert preview['unknown_count']==0 and preview['hint_count']==0 and preview['emitting_count']==2
  headers={'origin':'http://studio','idempotency-key':'launch'};body={'params':{'revision':revision,**input_options(client,revision),'use_hints':False,'line_blank':False,'rest_blank':False,'rest_token':False,'clear_unmatched':False,'merge_short_gaps':False,'gap_threshold_ms':500}}
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
  assert client.post('/api/v1/projects/p/jobs/alignment',json={'params':{'revision':revision,**input_options(client,revision),'use_hints':False,'line_blank':False,'rest_blank':False,'rest_token':False,'clear_unmatched':False,'merge_short_gaps':False,'gap_threshold_ms':500,'model_path':'/tmp/evil'}},headers={'origin':'http://studio'}).status_code==422


def test_cancellation_does_not_publish(tmp_path,monkeypatch):
 client,db,revision=prepare(tmp_path,monkeypatch)
 with client:
  headers={'origin':'http://studio'}
  jid=client.post('/api/v1/projects/p/jobs/alignment',json={'params':{'revision':revision,**input_options(client,revision),'use_hints':True,'line_blank':False,'rest_blank':False,'rest_token':False,'clear_unmatched':False,'merge_short_gaps':False,'gap_threshold_ms':500}},headers=headers).json()['id']
  client.post(f'/api/v1/jobs/{jid}/cancel',headers=headers)
  assert wait(client,jid)['status']=='cancelled'
  assert client.get(f'/api/v1/jobs/{jid}/result').status_code==409
  assert client.get('/api/v1/projects/p/document').json()['revision']==revision
  assert client.get('/api/v1/projects/p/alignment-preview',params={'revision':'stale','model':'stale'}).status_code==409


def test_cost_options_are_snapshotted_and_strict(tmp_path,monkeypatch):
 client,db,revision=prepare(tmp_path,monkeypatch)
 with client:
  params={'revision':revision,**input_options(client,revision),'use_hints':False,'clear_unmatched':False,'merge_short_gaps':False,'gap_threshold_ms':500,'line_blank':True,'rest_blank':False,'rest_token':True}
  reply=client.post('/api/v1/projects/p/jobs/alignment',json={'params':params},headers={'origin':'http://studio'})
  assert reply.status_code==202,reply.text
  jid=reply.json()['id'];assert wait(client,jid)['status']=='succeeded'
  actual=client.get(f'/api/v1/jobs/{jid}/result').json()['engine']['params']
  assert all(actual[k]==v for k,v in params.items())
  for value in (0,1,'true',None):
   params['rest_token']=value
   assert client.post('/api/v1/projects/p/jobs/alignment',json={'params':params},headers={'origin':'http://studio'}).status_code==422


def test_gap_policy_validation_and_job_snapshot(tmp_path,monkeypatch):
 client,db,revision=prepare(tmp_path,monkeypatch)
 base={'revision':revision,**input_options(client,revision),'use_hints':False,'line_blank':False,'rest_blank':False,'rest_token':False,'clear_unmatched':False,'merge_short_gaps':True,'gap_threshold_ms':499}
 with client:
  for field,values in [('gap_threshold_ms',[None,True,False,0,-1,1.5,'500',9007199254740992]),('merge_short_gaps',[None,0,1,'true'])]:
   for value in values:
    response=client.post('/api/v1/projects/p/jobs/alignment',json={'params':{**base,field:value}},headers={'origin':'http://studio'})
    assert response.status_code==422,response.text
  for enabled,threshold in [(True,499),(False,123)]:
   response=client.post('/api/v1/projects/p/jobs/alignment',json={'params':{**base,'merge_short_gaps':enabled,'gap_threshold_ms':threshold}},headers={'origin':'http://studio'})
   assert response.status_code==202,response.text
   jid=response.json()['id'];assert wait(client,jid)['status']=='succeeded'
   params=client.get(f'/api/v1/jobs/{jid}/result').json()['engine']['params']
   assert params['merge_short_gaps'] is enabled
   assert params['gap_threshold_ms']==(threshold if enabled else 500)


def input_options(client,revision):
 model=client.get('/api/v1/alignment-models').json()['items'][0]['id']
 preview=client.get('/api/v1/projects/p/alignment-preview',params={'revision':revision,'model':model}).json()
 return {'model_preview':preview['model_preview'],'latin_normalize':True,'strip_tone_digits':False}


def wait(client,job):
 deadline=time.monotonic()+20
 while time.monotonic()<deadline:
  value=client.get('/api/v1/jobs/'+job).json()
  if value['status'] in {'succeeded','failed','cancelled'}:return value
  time.sleep(.05)
 raise AssertionError('alignment worker did not finish')


def test_cpu_retry_uses_original_snapshot_after_catalog_switch(tmp_path,monkeypatch):
 import json
 from server.tests.test_alignment_models import model
 client,db,revision=prepare(tmp_path,monkeypatch)
 with client:
  params={'revision':revision,**input_options(client,revision),'use_hints':False,'line_blank':False,'rest_blank':False,'rest_token':False,'clear_unmatched':False,'merge_short_gaps':False,'gap_threshold_ms':500}
  headers={'origin':'http://studio','idempotency-key':'initial'}
  response=client.post('/api/v1/projects/p/jobs/alignment',json={'params':params},headers=headers)
  assert response.status_code==202,response.text
  assert '_model' not in response.json()['request']
  jid=response.json()['id'];assert wait(client,jid)['status']=='succeeded'
  with db.transaction() as c:
   original=json.loads(c.execute('SELECT request_json FROM jobs WHERE id=?',(jid,)).fetchone()[0])
   c.execute('UPDATE jobs SET status=?,error_json=? WHERE id=?',('failed',json.dumps({'cpu_retry':True}),jid))
  alternate=tmp_path/'alternate';model(alternate)
  monkeypatch.setenv('STUDIO_ALIGNMENT_MODELS_DIR',str(alternate))
  client.get('/api/v1/alignment-models',params={'refresh':True})
  from server.alignment_models import AlignmentModels
  monkeypatch.setattr(AlignmentModels,'capture',lambda *a:(_ for _ in ()).throw(AssertionError('lost response must reuse the durable snapshot')))
  again=client.post('/api/v1/projects/p/jobs/alignment',json={'params':params},headers=headers)
  assert again.status_code==202 and again.json()['id']==jid
  reply=client.post(f'/api/v1/jobs/{jid}/retry-cpu',json={'revision':revision},headers={**headers,'idempotency-key':'cpu'})
  assert reply.status_code==202,reply.text
  retry=reply.json()['id'];assert wait(client,retry)['status']=='succeeded'
  with db.connect() as c:
   actual=json.loads(c.execute('SELECT request_json FROM jobs WHERE id=?',(retry,)).fetchone()[0])
  assert actual['_model']==original['_model'] and actual['latin_normalize'] is True
  (tmp_path/'models/model/model.pt').write_bytes(b'changed')
  assert client.post(f'/api/v1/jobs/{jid}/retry-cpu',json={'revision':revision},headers=headers).status_code==409
  assert client.post('/api/v1/projects/p/jobs/alignment',json={'params':params},headers=headers).status_code==409
