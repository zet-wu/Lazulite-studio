"""Exercise the real service orchestration and Lazulite stages with small emissions."""
from dataclasses import replace
import numpy as np
import pytest
from server.tests.test_alignment import prepare
from server.tests.test_vocals import Separator
from server.project_document import read_project
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


def test_independent_run_manual_resource_reuse_and_no_alignment_storage(tmp_path,monkeypatch):
    from lazulite.audio import separation
    from lazulite.alignment.japanese import backend
    client,db,revision=prepare(tmp_path,monkeypatch)
    monkeypatch.setattr(separation,'DemucsSeparator',lambda config:Separator())
    monkeypatch.setattr(backend,'NextFireBackend',AcousticBackend)
    monkeypatch.setenv('STUDIO_NEXTFIRE_PATH','/selected/model')
    AcousticBackend.calls=AcousticBackend.closes=0
    with db.connect() as c:
        asset=c.execute("SELECT source_asset_id FROM projects WHERE id='p'").fetchone()[0]
    root=tmp_path/'projects'
    params={'revision':revision,'asset_id':asset,'use_hints':False,'line_blank':False,'rest_blank':False,'rest_token':False}
    request={'database':str(db.path),'root':str(root),'project_id':'p','params':params,
             'asset_path':str(root/'p/source/original'),'job_id':'first'}
    stale=root/'p/cache/alignment';stale.mkdir(parents=True)
    (stale/'invalid.json').write_text('not an acoustic result')
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
    second=run_alignment({**request,'job_id':'second'},lambda *args:None,lambda:False)
    assert second['acoustics'] is None
    assert second['alignment']['execution']['segment_source']=='manual'
    assert AcousticBackend.calls==AcousticBackend.closes==2
    assert (stale/'invalid.json').read_text()=='not an acoustic result'
    assert list(stale.iterdir())==[stale/'invalid.json']
    # Saved selection is checked against actual audio, not current model settings.
    snapshot['acoustics']['segments'][0]['endMs']=999999
    # Bypass document validation to exercise the compute boundary explicitly.
    monkeypatch.setattr(AlignmentRunner,'snapshot',lambda *args:(snapshot,asset))
    with pytest.raises(ValueError,match='超出'): run_alignment(request,lambda *args:None,lambda:False)


def test_backend_is_released_on_decode_failure(tmp_path,monkeypatch):
    from lazulite.audio import separation
    from lazulite.alignment.japanese import backend,run
    _,db,revision=prepare(tmp_path,monkeypatch)
    monkeypatch.setattr(separation,'DemucsSeparator',lambda config:Separator())
    monkeypatch.setattr(backend,'NextFireBackend',AcousticBackend)
    monkeypatch.setenv('STUDIO_NEXTFIRE_PATH','/selected/model')
    monkeypatch.setattr(run,'align_japanese',lambda *a,**kw:(_ for _ in ()).throw(RuntimeError('injected')))
    with db.connect() as c: asset=c.execute("SELECT source_asset_id FROM projects WHERE id='p'").fetchone()[0]
    before=AcousticBackend.closes
    with pytest.raises(RuntimeError,match='injected'):
        run_alignment({'database':str(db.path),'root':str(tmp_path/'projects'),'project_id':'p',
            'params':{'revision':revision,'asset_id':asset,'use_hints':False,'line_blank':False,'rest_blank':False,'rest_token':False},
            'asset_path':str(tmp_path/'projects/p/source/original'),'job_id':'failed'},lambda *a:None,lambda:False)
    assert AcousticBackend.closes==before+1
