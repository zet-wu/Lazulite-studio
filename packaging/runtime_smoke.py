"""Run with the assembled distribution interpreter and a build-tool-free PATH."""
import argparse
import json
import os
import platform
from pathlib import Path
import subprocess
import sys
import tempfile
import wave


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--target', required=True)
    args = parser.parse_args()
    root = args.root.resolve()
    if not Path(sys.executable).resolve().is_relative_to(root / 'runtime/python'):
        raise RuntimeError('冒烟必须使用包内解释器')
    manifest = json.loads((root / 'manifest.json').read_text(encoding='utf-8'))
    assert platform.python_version() == manifest['python'], (platform.python_version(), manifest['python'])
    import fastapi, uvicorn, torch, torchaudio, demucs, transformers, soundfile, lazulite, uroman
    # Load small required resources; exact linguistic results belong to development tests.
    uroman.Uroman()
    from sudachipy import dictionary
    from opencc import OpenCC
    dictionary.Dictionary().create()
    OpenCC('t2s')
    assert (root / 'vocal-models/demucs/htdemucs.yaml').is_file()
    assert (root / 'vocal-models/demucs/955717e8-8726e21a.th').is_file()
    assert (root / 'models').is_dir()
    if args.target != 'windows-x64-cuda':
        assert torch.version.cuda is None, torch.version.cuda
    else:
        assert torch.version.cuda and torch.version.cuda.startswith('12.6'), torch.version.cuda
    suffix = '.exe' if os.name == 'nt' else ''
    ffmpeg = root / 'runtime/ffmpeg' / ('ffmpeg' + suffix)
    ffprobe = root / 'runtime/ffmpeg' / ('ffprobe' + suffix)
    with tempfile.TemporaryDirectory(dir=root) as directory:
        directory = Path(directory)
        source = directory / 'input.wav'
        with wave.open(str(source), 'wb') as stream:
            stream.setnchannels(2); stream.setsampwidth(2); stream.setframerate(44100)
            stream.writeframes(b'\0' * 4413 * 4)
        # One short roundtrip checks encoding, probing and decoding.
        encoded = directory / 'encoded.m4a'
        subprocess.run([str(ffmpeg), '-v', 'error', '-i', str(source), '-c:a', 'aac', '-profile:a', 'aac_low', '-b:a', '192k', '-movie_timescale', '44100', str(encoded)], check=True)
        probe = subprocess.check_output([str(ffprobe), '-v', 'error', '-show_streams', '-show_packets',
                                         '-show_data_hash', 'sha256', '-of', 'json', str(encoded)], text=True)
        data = json.loads(probe)
        assert data['streams'] and data['packets'][0]['data_hash'].startswith('SHA256:')
        stream = data['streams'][0]
        assert stream['profile'] == 'LC' and stream['start_pts'] == 0 and stream['duration_ts'] == 4413
        first = data['packets'][0]
        assert first['pts'] < 0 and first['side_data_list'][0]['skip_samples'] == -first['pts']
        pcm = subprocess.check_output([str(ffmpeg), '-v', 'error', '-i', str(encoded), '-f', 's16le', '-'])
        assert 4413 <= len(pcm) // 4 < 4413 + 1024
    print(json.dumps({'python':sys.version, 'torch':torch.__version__, 'cuda_runtime':torch.version.cuda,
                      'torchaudio':torchaudio.__version__, 'small_resources':True, 'media_roundtrip':'0.1s AAC'}))


if __name__ == '__main__':
    main()
