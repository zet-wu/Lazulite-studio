"""AAC-LC products with an exact valid sample interval in an M4A edit list."""
from functools import lru_cache
import json
import os
from pathlib import Path
import subprocess
import numpy as np
from .process_supervisor import run
from .studio.media import Asset, MediaProbe

FORMAT = 'M4A AAC-LC'


@lru_cache(maxsize=128)
def inspect_audio(path: str, size: int, mtime_ns: int):
    result = run(['ffprobe', '-v', 'error', '-select_streams', 'a:0', '-show_streams',
                  '-of', 'json', path], check=True, capture_output=True, text=True)
    return json.loads(result.stdout)['streams'][0]


def encode_vocals(path: Path, samples: np.ndarray, rate: int, gain: float):
    """Publish only a complete encoded product; movie ticks preserve frame precision."""
    temporary = path.with_name('.encoding.m4a')
    try:
        run(['ffmpeg', '-y', '-v', 'error', '-f', 'f32le', '-ar', str(rate), '-ac', '2',
             '-i', 'pipe:0', '-c:a', 'aac', '-profile:a', 'aac_low', '-b:a', '192k',
             '-movie_timescale', str(rate), '-movflags', '+faststart', str(temporary)],
            input=(samples.T * gain).astype('<f4').tobytes(), check=True, capture_output=True)
        stat = temporary.stat()
        stream = inspect_audio(str(temporary), stat.st_size, stat.st_mtime_ns)
        # FFmpeg's MOV edit list removes encoder priming. Retain the exact
        # pre-encoding length separately from AAC's padded final decode block.
        if (stream['codec_name'] != 'aac' or stream.get('profile') != 'LC'
                or int(stream['sample_rate']) != rate or stream['channels'] != 2
                or stream['time_base'] != f'1/{rate}' or int(stream['start_pts']) != 0
                or int(stream['duration_ts']) != samples.shape[1]):
            raise ValueError('AAC 容器未保留有效音频时间范围')
        os.replace(temporary, path)
        return {'audio_bytes': stat.st_size, 'codec': 'aac', 'container': 'm4a',
                'bitrate': 192000, 'valid_frames': samples.shape[1],
                'time_origin': 'm4a-edit-list', 'audio_schema_version': 1}
    finally:
        temporary.unlink(missing_ok=True)


def available(path: Path, metadata):
    if metadata['format'] != FORMAT: return False
    try:
        stat = path.stat()
        if stat.st_size != metadata['audio_bytes']: return False
        stream = inspect_audio(str(path), stat.st_size, stat.st_mtime_ns)
        return (stream['codec_name'] == 'aac' and stream.get('profile') == 'LC'
                and int(stream['sample_rate']) == metadata['sample_rate']
                and stream['channels'] == metadata['channels']
                and int(stream['start_pts']) == 0
                and stream['time_base'] == f"1/{metadata['sample_rate']}"
                and int(stream['duration_ts']) == metadata['frames'])
    except (OSError, subprocess.CalledProcessError, ValueError, KeyError, IndexError):
        return False


def asset(path: Path, metadata):
    probe = MediaProbe(metadata['duration_ms'], 0, metadata['sample_rate'], 2, 'aac', 'm4a', 'audio/mp4')
    owner = metadata['audio_result_id']
    return Asset(owner, f'vocal-{owner}', path, 'vocals.m4a', metadata['audio_bytes'], probe,
                 valid_frames=metadata['frames'])


def analysis_samples(proxy):
    # Algorithms need floating point; the shared playback buffer stays int16.
    return np.frombuffer(proxy.pcm, dtype='<i2').reshape(-1, proxy.channels).astype(np.float32) / 32768
