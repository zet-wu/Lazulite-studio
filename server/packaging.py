"""Write only explicit lyric fields and verify payloads and non-target tags."""
from copy import deepcopy
from pathlib import Path
import hashlib
import json
import shutil
import subprocess
from mutagen import File
from mutagen.id3 import USLT
from mutagen.mp3 import MP3
from mutagen.flac import FLAC
from mutagen.mp4 import MP4
from .publishing import publish_stpp, extract_stpp, stpp_tracks


def packet_hashes(path):
    result = subprocess.run(['ffprobe','-v','error','-select_streams','a','-show_packets','-show_data_hash','sha256','-show_entries','packet=stream_index,data_hash','-of','json',str(path)],check=True,capture_output=True,text=True)
    # Stream indexes can change when a selected subtitle is replaced; audio order cannot.
    groups = {}
    for p in json.loads(result.stdout)['packets']:
        groups.setdefault(p['stream_index'],[]).append(p['data_hash'])
    return list(groups.values())


def tag_snapshot(media):
    if isinstance(media, MP3):
        return {k:deepcopy(v) for k,v in (media.tags or {}).items() if k != 'USLT::eng'}, list(getattr(media.tags,'unknown_frames',[]))
    key = '\xa9lyr' if isinstance(media, MP4) else 'lyrics'
    return {k:deepcopy(v) for k,v in (media.tags or {}).items() if k.lower() != key}, deepcopy(getattr(media,'pictures',[]))


def package_media(source: Path, output: Path, ttml: bytes | None, lrc: str, target_track_id=None):
    media = File(source)
    if not isinstance(media,(MP3, FLAC, MP4)): raise ValueError('仅支持 MP4/M4A、MP3 和 FLAC')
    before_tags, before_extra = tag_snapshot(media)
    before_audio = packet_hashes(source)
    if not before_audio: raise ValueError('源文件没有音轨')
    if isinstance(media, MP4):
        if ttml is None: raise ValueError('MP4 打包需要完整 TTML')
        report = publish_stpp(source,ttml,output,target_track_id=target_track_id)
    else:
        if target_track_id is not None: raise ValueError('此容器没有 STPP 轨道')
        shutil.copyfile(source, output)
    result = File(output)
    if result.tags is None: result.add_tags()
    if isinstance(result,MP3):
        # Only the English/default-description target; other language/descriptions survive.
        result.tags.add(USLT(encoding=3, lang='eng', desc='', text=lrc))
        version = media.tags.version[1] if media.tags and media.tags.version[1] in (3,4) else 4
        result.save(v2_version=version)
    elif isinstance(result,FLAC):
        result['LYRICS'] = [lrc]; result.save()
    else:
        result['\xa9lyr'] = [lrc]; result.save()
    checked = File(output)
    after_tags, after_extra = tag_snapshot(checked)
    if before_tags != after_tags or before_extra != after_extra: raise ValueError('非目标元数据或封面回读不一致')
    actual = checked.tags.get('USLT::eng').text if isinstance(checked,MP3) else checked['\xa9lyr' if isinstance(checked,MP4) else 'LYRICS'][0]
    if actual != lrc: raise ValueError('歌词标签回读不一致')
    if before_audio != packet_hashes(output): raise ValueError('音频载荷回读不一致')
    if isinstance(checked,MP4):
        target = target_track_id or max(t['track_id'] for t in stpp_tracks(output))
        if extract_stpp(output,target) != ttml: raise ValueError('STPP 回读不一致')
    return {'report':{'passed':True,'audio_preserved':True,'metadata_preserved':True,'lyrics_preserved':True,'audio_streams':len(before_audio),'subtitle_codec':'stpp' if isinstance(checked,MP4) else None,'ttml_sha256':hashlib.sha256(ttml).hexdigest() if ttml else None}}
