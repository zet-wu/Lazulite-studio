"""Uniform audio displacement: independent windows must agree before suggesting it."""
import numpy as np
from scipy import signal
from .process_supervisor import run

RATE = 2000


def decode_reference(path):
    raw = run(['ffmpeg', '-v', 'error', '-i', str(path), '-map', '0:a:0', '-ac', '1', '-ar', str(RATE),
               '-f', 'f32le', 'pipe:1'], check=True, capture_output=True).stdout
    return np.frombuffer(raw, dtype='<f4')


def estimate_offset(reference, uploaded):
    if min(len(reference), len(uploaded)) < 6 * RATE: return None
    band = signal.butter(3, [100, 850], btype='bandpass', fs=RATE, output='sos')
    reference = signal.sosfilt(band, reference).astype(np.float32)
    uploaded = signal.sosfilt(band, uploaded).astype(np.float32)
    size = min(12 * RATE, len(uploaded) // 3, len(reference) // 3)
    energy_sum = np.r_[0, np.cumsum(reference.astype(np.float64) ** 2)]
    offsets, strengths = [], []
    for third in range(3):
        starts = list(range(third * len(uploaded) // 3, (third + 1) * len(uploaded) // 3 - size + 1, max(RATE, size // 4)))
        start = max(starts, key=lambda i: float(np.dot(uploaded[i:i+size], uploaded[i:i+size])))
        window = uploaded[start:start+size]
        energy = float(np.dot(window, window))
        if energy < 1e-10: return None
        cross = signal.correlate(reference, window, mode='valid', method='fft')
        scores = np.abs(cross) / np.sqrt(np.maximum((energy_sum[size:] - energy_sum[:-size]) * energy, 1e-24))
        best = int(np.argmax(scores))
        # Repeated passages with similarly strong, distant peaks are ambiguous.
        outside = scores.copy(); outside[max(0, best-RATE):best+RATE+1] = 0
        if np.max(outside, initial=0) > scores[best] * .95: return None
        offsets.append((best-start)*1000/RATE); strengths.append(float(scores[best]))
    if max(offsets)-min(offsets) > 10 or np.median(strengths) < .2: return None
    return float(np.median(offsets))


def shift_samples(samples, frames, rate, offset_ms):
    if offset_ms >= frames * 1000 / rate or offset_ms <= -samples.shape[1] * 1000 / rate:
        raise ValueError('偏移后没有有效音频重叠，请调整偏移或重新选文件')
    shift = round(offset_ms * rate / 1000)
    source = max(0, -shift); destination = max(0, shift)
    count = min(samples.shape[1]-source, frames-destination)
    if count <= 0: raise ValueError('偏移后没有有效音频重叠，请调整偏移或重新选文件')
    output = np.zeros((samples.shape[0], frames), dtype=np.float32)
    output[:, destination:destination+count] = samples[:, source:source+count]
    return output


def decode_stereo(path, *, trim_padding=False):
    raw = run(['ffmpeg', '-v', 'error', '-i', str(path), '-map', '0:a:0', '-ac', '2', '-ar', '48000',
               '-f', 'f32le', 'pipe:1'], check=True, capture_output=True).stdout
    samples = np.frombuffer(raw, dtype='<f4').reshape(-1, 2).T
    if trim_padding:
        from .vocal_audio import inspect_audio
        from pathlib import Path
        from fractions import Fraction
        stat = Path(path).stat()
        info = inspect_audio(str(path), stat.st_size, stat.st_mtime_ns)
        if info.get('codec_name') == 'aac' and 'duration_ts' in info:
            frames = round(int(info['duration_ts']) * Fraction(info['time_base']) * 48000)
            samples = samples[:, :frames]
    return samples
