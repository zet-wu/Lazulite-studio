from types import SimpleNamespace
import numpy as np
import pytest
from lazulite.models.audio import AudioBuffer
from lazulite.models.japanese import Timing,Endpoint
from server.alignment_postprocessing import object_timings


def run(pairs, wave, groups=None):
    units=[SimpleNamespace(unit_id=str(i),proposed_timing=Timing(Endpoint(a,'acoustic_path') if a is not None else None,Endpoint(b,'acoustic_path') if b is not None else None)) for i,(a,b) in enumerate(pairs)]
    mapping=[{'unit_id':str(i),'object_id':str(groups[i] if groups else i)} for i in range(len(pairs))]
    audio=AudioBuffer(wave[None].astype(np.float32),1000,'vocals')
    return object_timings(SimpleNamespace(units=units),mapping,audio,True)


def test_complete_original_waveform_quiet_start_and_partial_envelope():
    wave=np.r_[np.ones(1000)*.1,np.zeros(200),np.ones(1800)*.1]
    times=run([(None,None),(.1,.5),(None,None),(2,2.1)],wave,[0,0,0,1])
    assert times['0']['start']['time']==.1
    assert times['0']['end']['time']==pytest.approx(1)
    assert times['1']['end']['time']==3


def test_no_silence_limit_skips_unmatched_and_crosses_rows_without_two_second_cap():
    times=run([(.1,.3),(None,None),(4,None),(4.5,4.8)],np.ones(6000)*.1)
    assert times['0']['end']['time']==4
    assert times['1']=={'start':None,'end':None}
    assert times['2']['end'] is None
    assert times['3']['end']['time']==6


def test_short_quiet_run_does_not_stop_and_overlapping_next_start_keeps_end():
    wave=np.r_[np.ones(1000)*.1,np.zeros(170),np.ones(1830)*.1]
    times=run([(.1,.5),(2,2.5),(2.4,2.8)],wave)
    assert times['0']['end']['time']==2
    assert times['1']['end']['time']==2.5
