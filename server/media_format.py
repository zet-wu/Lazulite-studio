"""Display and extension come from the detected media, never the uploaded suffix."""
from mutagen.mp4 import MP4
from mutagen.mp3 import MP3
from mutagen.flac import FLAC
from .publishing import _probe


def describe_media(path, media):
    if isinstance(media, MP4):
        video = any(stream.get('codec_type') == 'video' for stream in _probe(path).get('streams', []))
        return {'container': 'mp4', 'format_label': 'MP4' if video else 'M4A（MP4 容器）', 'extension': '.mp4' if video else '.m4a'}
    if isinstance(media, MP3): return {'container': 'mp3', 'format_label': 'MP3', 'extension': '.mp3'}
    if isinstance(media, FLAC): return {'container': 'flac', 'format_label': 'FLAC', 'extension': '.flac'}
    return {'container': None, 'format_label': type(media).__name__ if media else '未识别格式', 'extension': None}
