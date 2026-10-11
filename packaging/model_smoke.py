"""Real CPU smoke with all Python socket connections denied in this process."""
import argparse
import json,os,time,socket,sys

def deny_network(event, args):
    if event in ('socket.connect', 'socket.getaddrinfo', 'socket.sendto'):
        raise PermissionError('model smoke forbids network access')

from pathlib import Path
parser=argparse.ArgumentParser()
parser.add_argument('--models', type=Path, required=True)
parser.add_argument('--os-isolated', action='store_true')
args=parser.parse_args()
if args.os_isolated:
    # Probe before adding the Python audit hook: OS denial must be independently effective.
    try:
        with socket.create_connection(('1.1.1.1',443),timeout=2):
            raise AssertionError('OS network isolation is not effective')
    except OSError:
        pass
sys.addaudithook(deny_network)
os.environ['HF_HUB_OFFLINE']='1'
os.environ['TRANSFORMERS_OFFLINE']='1'
import numpy as np
from lazulite.models.audio import AudioBuffer,VocalSegment,VocalAnalysis
from lazulite.audio.separation import DemucsConfig,DemucsSeparator
from lazulite.audio.preparation import prepare_existing_vocals
from lazulite.models.japanese import JapaneseAlignmentRequest
from lazulite.alignment.japanese.run import align_japanese,JapaneseConfig
from lazulite.alignment.japanese.backend import NextFireBackend,NextFireConfig
import torch
start=time.monotonic();torch.set_num_threads(2)
try: socket.create_connection(('1.1.1.1',443),timeout=.2); raise AssertionError('network not blocked')
except PermissionError: pass
rate=44100
samples=(.15*np.sin(np.arange(rate*3)*2*np.pi*220/rate)).astype(np.float32)
audio=AudioBuffer(np.stack([samples,samples]),rate,'synthetic')
separator=DemucsSeparator(DemucsConfig(device='cpu',model_repo=str(args.models/'demucs')))
vocals=separator.separate(audio);separator.close()
assert vocals.samples.shape==(2,rate*3) and np.isfinite(vocals.samples).all()
segment=VocalSegment('s',None,0,3,0,3,None,None)
prepared=prepare_existing_vocals(vocals,original_id='synthetic',analysis=VocalAnalysis('synthetic',(segment,)),analysis_description={'configuration':{},'reference':'full_scale'},segments=(segment,),separation={'model':'htdemucs'})
backend=NextFireBackend(NextFireConfig(args.models/'nextfire',device='cpu'))
request=JapaneseAlignmentRequest.from_dict({'schema':'lazulite-japanese-request-v1','lines':[{'line_id':'l','text':'あ','units':[{'unit_id':'u','source_range':[0,1],'reading':'あ','reading_language':'ja','reading_source':'edited','reading_range':None}],'start_hint':None}]})
result=align_japanese(prepared,request,backend=backend,config=JapaneseConfig());backend.close()
assert result.status == 'complete' and len(result.units) == 1, result
print(json.dumps({'network':'OS isolation with rejected connectivity probe and Python socket hook' if args.os_isolated else 'Python socket audit hook only; not OS firewall isolation','torch':torch.__version__,'separation_frames':vocals.samples.shape[1],'alignment_status':result.status,'units':len(result.units),'seconds':time.monotonic()-start,'scope':'synthetic 3 seconds, CPU; not song quality or target-platform validation'}))
