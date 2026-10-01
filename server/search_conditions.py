"""Final acquisition strings; tags are read exactly once when a project is created."""
from pathlib import Path
from mutagen import File
from mutagen.mp4 import MP4
from mutagen.mp3 import MP3
from pydantic import BaseModel, ConfigDict, Field


class SearchConditions(BaseModel):
    model_config = ConfigDict(extra='forbid')
    title: str = Field(max_length=2000)
    artist: str = Field(max_length=2000)
    album: str = Field(max_length=2000)


def initial_conditions(path: Path, filename: str) -> dict:
    audio = File(path)
    tags = getattr(audio, 'tags', None) or {}
    keys = ('\xa9nam', '\xa9ART', '\xa9alb') if isinstance(audio, MP4) else ('TIT2', 'TPE1', 'TALB') if isinstance(audio, MP3) else ('title', 'artist', 'album')
    def joined(key):
        value = tags.get(key, [])
        if hasattr(value, 'text'): value = value.text
        if isinstance(value, str): value = [value]
        return ' '.join(str(part).strip() for part in value if str(part).strip())
    title, artist, album = map(joined, keys)
    return {'title': title or Path(filename).stem, 'artist': artist, 'album': album}


def read_conditions(c, pid):
    row = c.execute('SELECT title,artist,album FROM search_conditions WHERE project_id=?', (pid,)).fetchone()
    return dict(zip(('title', 'artist', 'album'), row or ('', '', '')))
