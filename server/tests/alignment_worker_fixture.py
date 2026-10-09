import json,sys,time,os
from server.vocal_process import PREFIX
from server.db import Database
from server.alignment import AlignmentRunner
from server.alignment_projection import project_alignment

def send(kind,**values):print(PREFIX+json.dumps({'kind':kind,**values}),flush=True)
request=json.loads(sys.stdin.readline())
send('event',values=['stage','acoustic',0,1,'fixture'])
end=time.monotonic()+.4
while time.monotonic()<end: pass
send('boundary')
if json.loads(sys.stdin.readline())['cancel']:
 send('error',type='cancelled',message='cancelled');sys.exit(1)
db=Database(request['database']);snapshot,_=AlignmentRunner(db,request['root']).snapshot(request['project_id'],request['params']['revision'])
projection=project_alignment(snapshot,request['params']['use_hints'])
send('result',value={'kind':'alignment','engine':{'worker_pid':os.getpid(),'params':request['params']},'mapping':projection['mapping'],'alignment':{'schema':'lazulite-japanese-result-v1','units':[{'unit_id':m['unit_id'],'line_id':m['line_id'],'proposed_timing':{'start':{'time':.1,'source':'test'},'end':{'time':.2,'source':'test'}}} for m in projection['mapping']]},'acoustics':None})
