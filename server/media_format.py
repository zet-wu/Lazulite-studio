"""Use detected containers and preserve compatible uploaded extensions."""
from pathlib import Path
import re
from mutagen.mp4 import MP4
from mutagen.mp3 import MP3
from mutagen.flac import FLAC
from .publishing import _probe


def describe_media(path, media, source_filename=None):
    if isinstance(media, MP4):
        video = any(stream.get('codec_type') == 'video' and not stream.get('disposition', {}).get('attached_pic') for stream in _probe(path).get('streams', []))
        suffix = Path(source_filename or path).suffix.lower()
        extension = '.mp4' if video else (suffix if suffix in {'.m4a', '.mp4'} else '.m4a')
        return {'container': 'mp4', 'format_label': 'MP4' if video else 'M4A（MP4 容器）', 'extension': extension}
    if isinstance(media, MP3): return {'container': 'mp3', 'format_label': 'MP3', 'extension': '.mp3'}
    if isinstance(media, FLAC): return {'container': 'flac', 'format_label': 'FLAC', 'extension': '.flac'}
    return {'container': None, 'format_label': type(media).__name__ if media else '未识别格式', 'extension': None}


def download_filename(project_name, extension):
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f\x7f]', '_', project_name).strip().rstrip('. ')
    if not name:
        name = '未命名项目'
    if re.match(r'^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)', name, re.I):
        name = '_' + name
    # Keep the encoded filename within common filesystem component limits.
    name = name.encode('utf-8')[:220].decode('utf-8', errors='ignore').rstrip('. ')
    return name + extension
