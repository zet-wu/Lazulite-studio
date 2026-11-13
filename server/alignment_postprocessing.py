"""Object envelopes and optional end extension on the complete vocal waveform."""
import math
import numpy as np


def object_timings(result, mapping, audio, smart_extend=False):
    units = {unit.unit_id:unit for unit in result.units}
    groups = {}
    for item in mapping:
        groups.setdefault(item['object_id'], []).append(units[item['unit_id']].proposed_timing)
    timings = {}
    for key, parts in groups.items():
        starts = [p.start.time for p in parts if p.start is not None]
        ends = [p.end.time for p in parts if p.end is not None]
        timings[key] = {'start': {'time':min(starts),'source':'object_envelope'} if starts else None,
                        'end': {'time':max(ends),'source':'object_envelope'} if ends else None}
    if not smart_extend:
        return timings
    mono = audio.samples.mean(axis=0)
    hop = round(audio.sample_rate*.01)
    frames = mono[:len(mono)//hop*hop].reshape(-1,hop)
    rms = np.sqrt(np.mean(frames.astype(np.float64)**2,axis=1))
    ordered = list(timings.values())
    for index, timing in enumerate(ordered):
        if timing['start'] is None or timing['end'] is None: continue
        start, end = timing['start']['time'], timing['end']['time']
        if not 0 <= start < end <= audio.duration: continue
        limit = min(audio.duration, next((t['start']['time'] for t in ordered[index+1:] if t['start'] is not None), audio.duration))
        if limit <= end: continue
        lo = max(0, int(max(start,end-.5)/.01))
        hi = min(len(rms),max(lo+1,math.ceil(end/.01)))
        if hi <= lo: continue
        threshold = max(float(rms[lo:hi].max())*10**(-23/20),10**(-65/20))
        run = 0
        extended = limit
        for frame in range(math.ceil(end/.01), min(len(rms),int(limit/.01))):
            run = run+1 if rms[frame] < threshold else 0
            if run >= 18:
                extended = max(end,(frame-17)*.01)
                break
        timing['end'] = {'time':extended,'source':'smart_end_extension'}
    return timings
