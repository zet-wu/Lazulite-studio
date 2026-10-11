"""Run with the relocated distribution interpreter and a build-tool-free PATH."""
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
    import fastapi, uvicorn, torch, torchaudio, demucs, transformers, soundfile, lazulite
    from sudachipy import dictionary
    from opencc import OpenCC
    assert dictionary.Dictionary().create().tokenize('日本語')
    assert OpenCC('t2s').convert('歌詞') == '歌词'
    sys.path.insert(0, str(root / 'app'))
    from server import furigana
    assert furigana.load_index()
    if args.target == 'windows-x64-cpu':
        assert torch.version.cuda is None, torch.version.cuda
    elif args.target == 'windows-x64-cuda':
        assert torch.version.cuda and torch.version.cuda.startswith('12.6'), torch.version.cuda
    suffix = '.exe' if os.name == 'nt' else ''
    ffmpeg = root / 'runtime/ffmpeg' / ('ffmpeg' + suffix)
    ffprobe = root / 'runtime/ffmpeg' / ('ffprobe' + suffix)
    decoders = subprocess.check_output([str(ffmpeg), '-hide_banner', '-decoders'], text=True, stderr=subprocess.STDOUT)
    for codec in ('aac', 'mp3', 'flac', 'alac', 'pcm_s16le'):
        assert any(codec == line.split()[1] for line in decoders.splitlines() if len(line.split()) > 1), codec
    with tempfile.TemporaryDirectory(dir=root) as directory:
        directory = Path(directory)
        source = directory / 'input.wav'
        with wave.open(str(source), 'wb') as stream:
            stream.setnchannels(2); stream.setsampwidth(2); stream.setframerate(44100)
            stream.writeframes(b'\0' * 44100 * 4)
        # Exercise codecs/container probing and packet hashing used by Studio.
        for extension, codec in [('m4a', 'aac'), ('flac', 'flac'), ('wav', 'pcm_s16le')]:
            encoded = directory / ('encoded.' + extension)
            subprocess.run([str(ffmpeg), '-v', 'error', '-i', str(source), '-c:a', codec, str(encoded)], check=True)
            probe = subprocess.check_output([str(ffprobe), '-v', 'error', '-show_streams', '-show_packets',
                                             '-show_data_hash', 'sha256', '-of', 'json', str(encoded)], text=True)
            data = json.loads(probe)
            assert data['streams'] and data['packets'][0]['data_hash'].startswith('SHA256:')
            subprocess.run([str(ffmpeg), '-v', 'error', '-i', str(encoded), '-f', 'null', '-'], check=True)
    print(json.dumps({'python':sys.version, 'torch':torch.__version__, 'cuda_runtime':torch.version.cuda,
                      'torchaudio':torchaudio.__version__, 'dictionary':True, 'conversion':True, 'media':True}))


if __name__ == '__main__':
    main()
