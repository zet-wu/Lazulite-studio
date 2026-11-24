"""Exercise the real service orchestration and Lazulite stages with small emissions."""
from dataclasses import replace
import numpy as np
import pytest
from server.tests.test_alignment import prepare
from server.tests.test_vocals import Separator
from server.revisions import RevisionStore
from server.alignment import run_alignment,AlignmentRunner
from lazulite.alignment.japanese.stages import FrameMap


class AcousticBackend:
    frames=FrameMap(8000,80,100)
    vocab={c:i for i,c in enumerate('abcdefghijklmnopqrstuvwxyz')}
    blank=26
    vocabulary_size=27
    special_tokens=()
    description={'adapter':'test-dynamic'}
    calls=0
    closes=0
    def __init__(self,config): pass
    def emissions(self,audio,**kw):
        AcousticBackend.calls+=1
        assert audio.sample_rate==8000
        return np.full((self.frames.count(audio.samples.shape[1]),27),-np.log(27),np.float32)
    def close(self): AcousticBackend.closes+=1


def test_independent_run_and_manual_resource_reuse(tmp_path,monkeypatch):
    from lazulite.audio import separation
    from lazulite.alignment.japanese import backend
    client,db,revision=prepare(tmp_path,monkeypatch)
    monkeypatch.setattr(separation,'DemucsSeparator',lambda config:Separator())
    monkeypatch.setattr(backend,'open_backend',lambda path,device:AcousticBackend(None))
    from server.alignment_models import model_snapshot
    selected=model_snapshot(tmp_path/'models/model')
    AcousticBackend.calls=AcousticBackend.closes=0
    with db.connect() as c:
        asset=c.execute("SELECT source_asset_id FROM projects WHERE id='p'").fetchone()[0]
    root=tmp_path/'projects'
    params={'audio_source':'vocals','crop_vocals':True,'scope_ids':None,'revision':revision,'asset_id':asset,'_model':selected,'convert_particles':True,'latin_normalize':True,'strip_tone_digits':False,'smart_extend':False,'use_hints':False,'line_blank':False,'rest_blank':False,'rest_token':False}
    request={'database':str(db.path),'root':str(root),'project_id':'p','params':params,
             'asset_path':str(root/'p/source/original'),'job_id':'first'}
    first=run_alignment(request,lambda *args:None,lambda:False)
    assert first['acoustics'] and first['alignment']['units']
    assert AcousticBackend.calls==AcousticBackend.closes==1
    snapshot,_=AlignmentRunner(db,root).snapshot('p',revision)
    snapshot['acoustics']={'analysisId':first['acoustics']['analysisId'],
                          'segments':[{'id':'manual','beginMs':500,'endMs':1200}]}
    revision=RevisionStore(db,root).create('p',snapshot,revision)['id']
    params['revision']=revision
    monkeypatch.setenv('STUDIO_VOCAL_MODEL','changed-generation-settings')
    def no_separation(*args): raise AssertionError('selected complete vocals must be consumed directly')
    monkeypatch.setattr(separation,'DemucsSeparator',no_separation)
    from server import alignment_postprocessing
    original_timings = alignment_postprocessing.object_timings
    consumed_segments = []
    def capture_timings(*args, segments, **kwargs):
        consumed_segments.append([(s.core_start, s.core_end) for s in segments])
        return original_timings(*args, segments=segments, **kwargs)
    monkeypatch.setattr(alignment_postprocessing, 'object_timings', capture_timings)
    params['smart_extend'] = True
    second=run_alignment({**request,'job_id':'second'},lambda *args:None,lambda:False)
    assert consumed_segments == [[(.5, 1.2)]]
    assert second['acoustics'] is None
    assert second['alignment']['execution']['segment_source']=='manual'
    assert AcousticBackend.calls==AcousticBackend.closes==2
    # The persisted manual interval can exceed the media. Sampling intersects PCM.
    snapshot['acoustics']['segments'][0]['endMs']=999999
    params['revision']=RevisionStore(db,root).create('p',snapshot,revision)['id']
    third=run_alignment({**request,'job_id':'third'},lambda *args:None,lambda:False)
    assert third['acoustics'] is None
    assert third['alignment']['execution']['segment_source']=='manual'
    reopened,_=AlignmentRunner(db,root).snapshot('p',params['revision'])
    assert reopened['acoustics']['segments'][0]['endMs']==999999



def test_backend_is_released_on_decode_failure(tmp_path,monkeypatch):
    from lazulite.audio import separation
    from lazulite.alignment.japanese import backend,run
    _,db,revision=prepare(tmp_path,monkeypatch)
    monkeypatch.setattr(separation,'DemucsSeparator',lambda config:Separator())
    monkeypatch.setattr(backend,'open_backend',lambda path,device:AcousticBackend(None))
    from server.alignment_models import model_snapshot
    selected=model_snapshot(tmp_path/'models/model')
    monkeypatch.setattr(run,'align_japanese',lambda *a,**kw:(_ for _ in ()).throw(RuntimeError('injected')))
    with db.connect() as c: asset=c.execute("SELECT source_asset_id FROM projects WHERE id='p'").fetchone()[0]
    before=AcousticBackend.closes
    with pytest.raises(RuntimeError,match='injected'):
        run_alignment({'database':str(db.path),'root':str(tmp_path/'projects'),'project_id':'p',
            'params':{'audio_source':'vocals','crop_vocals':True,'scope_ids':None,'revision':revision,'asset_id':asset,'_model':selected,'convert_particles':True,'latin_normalize':True,'strip_tone_digits':False,'smart_extend':False,'use_hints':False,'line_blank':False,'rest_blank':False,'rest_token':False},
            'asset_path':str(tmp_path/'projects/p/source/original'),'job_id':'failed'},lambda *a:None,lambda:False)
    assert AcousticBackend.closes==before+1

@pytest.mark.parametrize('audio_source',['original','vocals'])
@pytest.mark.parametrize('crop',[False,True])
@pytest.mark.parametrize('local',[False,True])
def test_audio_source_crop_and_scope_are_independent(tmp_path,monkeypatch,audio_source,crop,local):
    from lazulite.audio import separation
    from lazulite.alignment.japanese import backend,run
    from server.alignment_models import model_snapshot
    from server.project_document import initial_project
    _,db,revision=prepare(tmp_path,monkeypatch)
    snapshot=initial_project('<tt xmlns="http://www.w3.org/ns/ttml" xmlns:studio="urn:lazulite:studio:draft"><body><p xml:id="line" begin="0" end="2"><span studio:id="a" begin="0.6" end="0.8">a</span><span studio:id="b" begin="0.8" end="1.2">b</span></p></body></tt>')
    if local:snapshot['editing']['skippedAlignmentLineIds']=['line']
    revision=RevisionStore(db,tmp_path/'projects').create('p',snapshot,revision)['id']
    calls=[]
    class CountSeparator(Separator):
        def separate(self,audio):calls.append('separate');return super().separate(audio)
    monkeypatch.setattr(separation,'DemucsSeparator',lambda config:CountSeparator())
    monkeypatch.setattr(backend,'open_backend',lambda path,device:AcousticBackend(None))
    captured=[];original=run.align_japanese
    def align(prepared,*args,**kwargs):
        captured.append([(s.core_start,s.core_end) for s in prepared.segments])
        return original(prepared,*args,**kwargs)
    monkeypatch.setattr(run,'align_japanese',align)
    with db.connect() as c:asset=c.execute("SELECT source_asset_id FROM projects WHERE id='p'").fetchone()[0]
    params={'revision':revision,'asset_id':asset,'_model':model_snapshot(tmp_path/'models/model'),'convert_particles':False,'latin_normalize':True,'strip_tone_digits':False,'smart_extend':False,'use_hints':False,'line_blank':False,'rest_blank':False,'rest_token':False,'audio_source':audio_source,'crop_vocals':crop,'scope_ids':['a','b'] if local else None}
    result=run_alignment({'database':str(db.path),'root':str(tmp_path/'projects'),'project_id':'p','params':params,'asset_path':str(tmp_path/'projects/p/source/original'),'job_id':'matrix'},lambda *args:None,lambda:False)
    assert len(calls)==(0 if audio_source=='original' and not crop else 1)
    assert result['selection']==params['scope_ids']
    assert len(result['scope'])==2
    assert captured[0]
    if local:assert all(.6<=a<b<=1.2 for a,b in captured[0])
    if not crop:assert captured==[[(.6,1.2) if local else (0,2)]]
    # Every model result is in original media coordinates, even after native cutting.
    if local:
        for unit in result['alignment']['units']:
            for point in unit['proposed_timing'].values():
                if point is not None:assert .6<=point['time']<=1.2
