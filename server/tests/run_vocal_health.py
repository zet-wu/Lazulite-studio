"""Opt-in CUDA separation plus HTTP health probe, using an isolated temporary project.

Run: python -m server.tests.run_vocal_health --source FILE --output REPORT.json
"""
import argparse,os,time,json,socket,threading,urllib.request,tempfile
from pathlib import Path
import uvicorn
from server.app import create_app
from server.auth import Settings
from server.db import Database
from server.revisions import RevisionStore
from server.tests.media_fixture import add_media_project

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args=parser.parse_args()
    root=Path(tempfile.mkdtemp(prefix='studio-vocal-isolated-'))
    source=args.source
    db=Database(root/'studio.sqlite3')
    add_media_project(root,db,RevisionStore(db,root/'revisions'),'probe',source,'<tt xmlns="http://www.w3.org/ns/ttml"><body><div/></body></tt>')
    sock=socket.socket();sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
    origin=f'http://127.0.0.1:{port}'
    os.environ['STUDIO_VOCAL_DEVICE']='cuda'
    app=create_app(root,Settings(None,True,origin))
    server=uvicorn.Server(uvicorn.Config(app,log_level='warning',access_log=False))
    thread=threading.Thread(target=lambda:server.run(sockets=[sock]),daemon=True);thread.start()
    client=urllib.request.build_opener(urllib.request.ProxyHandler({}))
    def get(path,data=None):
     request=urllib.request.Request(origin+path,data=json.dumps(data).encode() if data is not None else None,headers={'origin':origin,'content-type':'application/json'})
     with client.open(request,timeout=2) as response:return json.load(response)
    deadline=time.monotonic()+20
    while not server.started:
     if time.monotonic()>deadline: raise RuntimeError('probe API did not start')
     time.sleep(.05)
    asset=get('/api/v1/projects/probe/document')['document']['sourceAssetId']
    job=get('/api/v1/projects/probe/jobs/vocal',{'params':{'asset_id':asset}})['id']
    start=time.monotonic();health=[];stage=None;out=None
    print(json.dumps({'root':str(root),'port':port,'job':job}),flush=True)
    try:
     while time.monotonic()-start<300:
      before=time.monotonic()
      try:get('/api/v1/session');health.append({'ms':round((time.monotonic()-before)*1000,2),'ok':True})
      except Exception as exc:health.append({'ms':round((time.monotonic()-before)*1000,2),'ok':False,'error':str(exc)})
      out=get('/api/v1/jobs/'+job)
      if out['stage']!=stage:stage=out['stage'];print(json.dumps({'elapsed':round(time.monotonic()-start,2),'stage':stage}),flush=True)
      if out['status'] in ['succeeded','failed','cancelled']:break
      time.sleep(1)
     results=get('/api/v1/projects/probe/vocals')
     report={'root':str(root),'elapsed_seconds':round(time.monotonic()-start,2),'job':out,'health_count':len(health),'health_failures':sum(not h['ok'] for h in health),'health_max_ms':max(h['ms'] for h in health),'health':health,'results':[{'status':r['status'],'frames':r['frames'],'sample_rate':r['sample_rate'],'segments':len(r.get('segments',[]))} for r in results['items']]}
     args.output.write_text(json.dumps(report,ensure_ascii=False,indent=2));print(json.dumps({k:v for k,v in report.items() if k!='health'},ensure_ascii=False),flush=True)
     assert out['status']=='succeeded' and report['health_failures']==0, report
    finally:
     server.should_exit=True;thread.join(10)


if __name__ == "__main__":
    main()
