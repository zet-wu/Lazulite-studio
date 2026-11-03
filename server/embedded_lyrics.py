"""Read separate lyric candidates from the project's original uploaded media."""
from pathlib import Path
import re
import struct
from mutagen import File
from mutagen.mp3 import MP3
from mutagen.mp4 import MP4
from mutagen.flac import FLAC
from .publishing import stpp_tracks, extract_stpp


class EmbeddedError(ValueError):
    def __init__(self, code, message):
        self.code = code
        super().__init__(message)


def lyric_format(text):
    if re.search(r'<\d+:\d{2}(?:\.\d+)?>', text):
        return 'elrc'
    if re.search(r'\[\d+:\d{2}(?:\.\d+)?\][^\r\n\[]+\[\d+:\d{2}(?:\.\d+)?\]', text):
        return 'eslrc'
    if re.search(r'^\[\d+:\d{2}(?:\.\d+)?\]', text, re.M):
        return 'lrc'
    raise EmbeddedError('invalid_format', '不支持的内嵌歌词结构：需要 LRC、逐词扩展 LRC 或 STPP TTML')


def read_embedded(path: Path):
    media = File(path)
    candidates = []
    def add(label, text, format=None):
        candidate = {'id': str(len(candidates)), 'label': label}
        try:
            candidate.update(content=text, format=format or lyric_format(text))
        except ValueError as exc:
            candidate['error'] = str(exc)
            candidate['error_code'] = exc.code if isinstance(exc, EmbeddedError) else 'invalid_format'
        candidates.append(candidate)
    if isinstance(media, MP3):
        for frame in (media.tags.getall('USLT') if media.tags else []):
            add(f'USLT · {frame.lang}{" · " + frame.desc if frame.desc else ""}', frame.text)
        if media.tags and media.tags.getall('SYLT'):
            candidates.append({'id': 'sylt', 'label': 'SYLT', 'error_code': 'unsupported_sylt', 'error': '不支持 SYLT 同步歌词结构'})
    elif isinstance(media, FLAC):
        for key in ('lyrics', 'unsyncedlyrics'):
            for index, text in enumerate(media.get(key, [])):
                add(f'{key} · {index + 1}', text)
    elif isinstance(media, MP4):
        for index, text in enumerate(media.get('\xa9lyr', [])):
            add(f'©lyr · {index + 1}', text)
        for track in stpp_tracks(path):
            label = f'STPP · #{track["track_id"]}'
            try:
                add(label, extract_stpp(path, track['track_id']).decode('utf-8-sig'), 'ttml')
            except (ValueError, UnicodeError, struct.error) as exc:
                candidates.append({'id': f'stpp-{track["track_id"]}', 'label': label, 'error_code': 'stpp_read_failed', 'error': f'STPP 读取失败：{exc}'})
    else:
        raise ValueError('当前内嵌来源仅支持 MP3、FLAC、MP4/M4A 容器')
    return candidates
