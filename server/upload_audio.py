"""Normalize user uploads before registering immutable assets (never archives)."""
import json
import subprocess
import numpy as np
from pathlib import Path
from .process_supervisor import run
from .studio.media import MediaError


def normalize_upload(path: Path, filename: str):
    try:
        return _normalize_upload(path, filename)
    except subprocess.CalledProcessError as exc:
        raise MediaError('无法读取或抽取音轨，请选择可解码的音频文件') from exc


def _normalize_upload(path: Path, filename: str):
    info = json.loads(run(['ffprobe', '-v', 'error', '-show_streams', '-of', 'json', str(path)],
                          check=True, capture_output=True, text=True).stdout)
    streams = info.get('streams', [])
    if not any(s['codec_type'] == 'video' and not s.get('disposition', {}).get('attached_pic') for s in streams): return path, filename
    audio = next((s for s in streams if s['codec_type'] == 'audio'), None)
    if audio is None: raise MediaError('上传文件不包含音轨')
    codec = audio['codec_name']
    extension = {'aac': 'm4a', 'alac': 'm4a', 'mp3': 'mp3', 'flac': 'flac', 'opus': 'ogg', 'vorbis': 'ogg'}.get(codec, 'mka')
    output = path.with_name('audio.' + extension)
    run(['ffmpeg', '-y', '-v', 'error', '-i', str(path), '-map', '0:a:0', '-vn', '-sn', '-dn',
         '-map_metadata', '-1', '-c:a', 'copy', str(output)], check=True, capture_output=True)
    # Studio plays decoded audio from frame zero. Verify remuxing preserved that
    # timeline, including AAC priming / tail edits and nonzero input timestamps.
    def pcm(source):
        return run(['ffmpeg', '-v', 'error', '-i', str(source), '-map', '0:a:0', '-ac', '2',
                    '-ar', '48000', '-f', 's16le', 'pipe:1'], check=True, capture_output=True).stdout
    original = pcm(path)
    def same_timeline(candidate):
        return len(original) == len(candidate) and np.max(np.abs(np.frombuffer(original, '<i2').astype(np.int32) - np.frombuffer(candidate, '<i2')), initial=0) <= 1
    if not same_timeline(pcm(output)):
        output.unlink()
        output = path.with_name('audio.flac')
        # Lossless PCM fallback, keeping the original sample clock and channels;
        # 24-bit FLAC avoids another lossy generation when container edits differ.
        run(['ffmpeg', '-y', '-v', 'error', '-i', str(path), '-map', '0:a:0', '-vn', '-sn', '-dn',
             '-map_metadata', '-1', '-c:a', 'flac', '-sample_fmt', 's32', str(output)], check=True, capture_output=True)
        original = pcm(path)
    def same_timeline(candidate):
        return len(original) == len(candidate) and np.max(np.abs(np.frombuffer(original, '<i2').astype(np.int32) - np.frombuffer(candidate, '<i2')), initial=0) <= 1
    if not same_timeline(pcm(output)): raise MediaError('音轨抽取未保留播放时间，请改用音频文件')
    return output, Path(filename).stem + output.suffix
