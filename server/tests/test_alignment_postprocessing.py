from types import SimpleNamespace
import numpy as np
import pytest
from lazulite.models.audio import AudioBuffer
from lazulite.models.japanese import Timing,Endpoint
from server.alignment_postprocessing import object_timings


def run(pairs, wave, groups=None, boundaries=(), smart_extend=True):
    units=[SimpleNamespace(unit_id=str(i),proposed_timing=Timing(Endpoint(a,'acoustic_path') if a is not None else None,Endpoint(b,'acoustic_path') if b is not None else None)) for i,(a,b) in enumerate(pairs)]
    mapping=[{'unit_id':str(i),'object_id':str(groups[i] if groups else i)} for i in range(len(pairs))]
    audio=AudioBuffer(wave[None].astype(np.float32),1000,'vocals')
    return object_timings(SimpleNamespace(units=units),mapping,audio,smart_extend, segments=[SimpleNamespace(core_end=end) for end in boundaries])


def test_complete_original_waveform_quiet_start_and_partial_envelope():
    wave=np.r_[np.ones(1000)*.1,np.zeros(200),np.ones(1800)*.1]
    times=run([(None,None),(.1,.5),(None,None),(2,2.1)],wave,[0,0,0,1])
    assert times['0']['start']['time']==.1
    assert times['0']['end']['time']==pytest.approx(1.02)
    assert times['1']['end']['time']==3


def test_no_silence_limit_skips_unmatched_and_crosses_rows_without_two_second_cap():
    times=run([(.1,.3),(None,None),(4,None),(4.5,4.8)],np.ones(6000)*.1)
    assert times['0']['end']['time']==4
    assert times['1']=={'start':None,'end':None}
    assert times['2']['end'] is None
    assert times['3']['end']['time']==6


def test_short_quiet_run_stops_and_overlapping_next_start_keeps_end():
    wave=np.r_[np.ones(1000)*.1,np.zeros(170),np.ones(1830)*.1]
    times=run([(.1,.5),(2,2.5),(2.4,2.8)],wave)
    assert times['0']['end']['time']==1.02
    assert times['1']['end']['time']==2.5


@pytest.mark.parametrize('boundary, expected', [(0.4, 2), (0.5, 0.5), (0.8, 0.8), (2.5, 2)])
def test_all_segment_boundaries_compete_with_next_start(boundary, expected):
    times=run([(.1,.5),(2,2.5)],np.ones(3000)*.1,boundaries=[boundary,3])
    assert times['0']['end']['time']==expected


def test_disabled_extension_preserves_envelopes():
    times=run([(.1,.5),(.2,.7),(None,None)],np.ones(3000),groups=[0,0,1],boundaries=[1],smart_extend=False)
    assert times['0']=={'start':{'time':.1,'source':'object_envelope'},'end':{'time':.7,'source':'object_envelope'}}
    assert times['1']=={'start':None,'end':None}


def test_silent_audio_and_short_tail_use_duration_cap():
    assert run([(.001,.004)],np.zeros(15))['0']['end']['time']==.015
    assert run([(.001,.004)],np.ones(15))['0']['end']['time']==.01
