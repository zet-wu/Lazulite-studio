"""Object envelopes and optional end extension on the complete vocal waveform."""
from bisect import bisect_left
import numpy as np


def non_silent_ends(audio):
    """FA-Kara fine RMS rule: centered 20 ms windows, 50% overlap.

    Use NumPy directly so end extension needs no additional audio dependency.
    Match float32 RMS, zero padding and the 5 ms falling-edge expansion.
    """
    mono = audio.samples.mean(axis=0)
    window = int(audio.sample_rate * .02)
    hop = window // 2
    padded = np.pad(mono, (window // 2, window // 2))
    frames = np.lib.stride_tricks.sliding_window_view(padded, window)[::hop]
    rms = np.empty(len(frames), dtype=np.float32)
    # Bound the temporary squared waveform even for long recordings.
    for offset in range(0, len(frames), 4096):
        block = frames[offset:offset + 4096]
        rms[offset:offset + len(block)] = np.sqrt(np.mean(np.square(block, dtype=np.float32), axis=1))
    active = rms > np.percentile(rms, 90) * .1
    falling = np.flatnonzero(active[:-1] & ~active[1:]) + 1
    ends = falling * hop / audio.sample_rate + .005
    if active[-1]:
        ends = np.append(ends, (len(active) - 1) * hop / audio.sample_rate)
    return np.unique(np.ceil(ends * 100) / 100).tolist()


def object_timings(result, mapping, audio, smart_extend=False, *, segments):
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
    silence_ends = non_silent_ends(audio)
    boundaries = sorted({segment.core_end for segment in segments})
    ordered = list(timings.values())
    for index, timing in enumerate(ordered):
        if timing['start'] is None or timing['end'] is None: continue
        start, end = timing['start']['time'], timing['end']['time']
        if not 0 <= start < end <= audio.duration: continue
        limit = min(audio.duration, next((t['start']['time'] for t in ordered[index+1:] if t['start'] is not None), audio.duration))
        if limit <= end: continue
        extended = limit
        for candidates in (silence_ends, boundaries):
            candidate = bisect_left(candidates, end)
            if candidate < len(candidates):
                extended = min(extended, candidates[candidate])
        timing['end'] = {'time':extended,'source':'smart_end_extension'}
    return timings
