"""Write only explicit lyric fields and verify payloads and non-target tags."""
from copy import deepcopy
from pathlib import Path
import hashlib
import json
import shutil
import subprocess
from .process_supervisor import run as run_process
from mutagen import File
from mutagen.id3 import USLT
from mutagen.mp3 import MP3
from mutagen.flac import FLAC
from mutagen.mp4 import MP4
from .publishing import publish_stpp, extract_stpp, stpp_tracks


def packet_hashes(path):
    result = run_process(['ffprobe','-v','error','-select_streams','a','-show_packets','-show_data_hash','sha256','-show_entries','packet=stream_index,data_hash','-of','json',str(path)],check=True,capture_output=True,text=True)
    # Stream indexes can change when a selected subtitle is replaced; audio order cannot.
    groups = {}
    for p in json.loads(result.stdout)['packets']:
        groups.setdefault(p['stream_index'],[]).append(p['data_hash'])
    return list(groups.values())


def tag_snapshot(media, preserve_lyrics=False):
    if isinstance(media, MP3):
        return {k:deepcopy(v) for k,v in (media.tags or {}).items() if k != 'USLT::eng'}, list(getattr(media.tags,'unknown_frames',[]))
    key = '\xa9lyr' if isinstance(media, MP4) else 'lyrics'
    extra = [(block.code, block.write()) for block in media.metadata_blocks if block.code not in (1, 4)] if isinstance(media, FLAC) else []
    return {k:deepcopy(v) for k,v in (media.tags or {}).items() if preserve_lyrics or k.lower() != key}, extra


def package_media(source: Path, output: Path, ttml: bytes | None, lrc: str | None, target_track_id=None):
    media = File(source)
    if not isinstance(media,(MP3, FLAC, MP4)): raise ValueError('仅支持 MP4/M4A、MP3 和 FLAC')
    if lrc is None and not isinstance(media, MP4): raise ValueError('此容器需要写入 LRC')
    before_tags, before_extra = tag_snapshot(media, lrc is None)
    before_audio = packet_hashes(source)
    if not before_audio: raise ValueError('源文件没有音轨')
    if isinstance(media, MP4):
        if ttml is None: raise ValueError('MP4 打包需要完整 TTML')
        original_stpp_ids = {track['track_id'] for track in stpp_tracks(source)}
        before_tracks, before_mdats = mp4_snapshot(source, target_track_id)
        publish_stpp(source,ttml,output,target_track_id=target_track_id)
    else:
        if target_track_id is not None: raise ValueError('此容器没有 STPP 轨道')
        shutil.copyfile(source, output)
    result = File(output)
    if lrc is not None and result.tags is None: result.add_tags()
    if isinstance(result,MP3):
        # Only the English/default-description target; other language/descriptions survive.
        result.tags.add(USLT(encoding=3, lang='eng', desc='', text=lrc))
        version = media.tags.version[1] if media.tags and media.tags.version[1] in (3,4) else 4
        result.save(v2_version=version)
    elif isinstance(result,FLAC):
        result['LYRICS'] = [lrc]; result.save()
    elif lrc is not None:
        result['\xa9lyr'] = [lrc]; result.save()
    checked = File(output)
    after_tags, after_extra = tag_snapshot(checked, lrc is None)
    if before_tags != after_tags or before_extra != after_extra: raise ValueError('非目标元数据或封面回读不一致')
    if lrc is not None:
        actual = checked.tags.get('USLT::eng').text if isinstance(checked,MP3) else checked['\xa9lyr' if isinstance(checked,MP4) else 'LYRICS'][0]
        if actual != lrc: raise ValueError('歌词标签回读不一致')
    if before_audio != packet_hashes(output): raise ValueError('音频载荷回读不一致')
    if isinstance(checked,MP4):
        after_tracks, after_mdats = mp4_snapshot(output, target_track_id)
        if any(after_tracks.get(key) != value for key, value in before_tracks.items()) or after_mdats[:len(before_mdats)] != before_mdats:
            raise ValueError('非目标轨道或原始媒体数据回读不一致')
        new_ids = {track['track_id'] for track in stpp_tracks(output)} - original_stpp_ids
        if target_track_id is None and len(new_ids) != 1: raise ValueError('新增 STPP 轨道无法唯一确认')
        target = target_track_id if target_track_id is not None else new_ids.pop()
        if extract_stpp(output,target) != ttml: raise ValueError('STPP 回读不一致')
    return {'report':{'passed':True,'audio_preserved':True,'metadata_preserved':True,'lyrics_preserved':True,'audio_streams':len(before_audio),'subtitle_codec':'stpp' if isinstance(checked,MP4) else None,'track_id':target if isinstance(checked,MP4) else None}}


def mp4_snapshot(path, excluded_track_id=None):
    """Preserve every original mdat and non-target track, allowing chunk relocation."""
    import struct
    from .publishing import _scan_top, _read_payload, _boxes, _find, _trak_id, _box
    top = list(_scan_top(path))
    moov_box = next(item for item in top if item[0] == b'moov')
    moov = _read_payload(path, *moov_box[1:])
    def normalize(payload):
        parts = []
        for kind, body, _, _ in _boxes(payload):
            if kind in (b'stco', b'co64'):
                # Same ordered chunks; their absolute offsets change when tags grow.
                parts.append(_box(b'co64', body[:8]))
            else:
                parts.append(_box(kind, normalize(body) if kind in (b'mdia', b'minf', b'stbl') else body))
        return b''.join(parts)
    tracks = {_trak_id(body): normalize(body) for kind, body, _, _ in _boxes(moov)
              if kind == b'trak' and _trak_id(body) != excluded_track_id}
    mdats = []
    with path.open('rb') as stream:
        for kind, pos, size, header in top:
            if kind != b'mdat': continue
            stream.seek(pos + header); remaining = size - header; digest = hashlib.sha256()
            while remaining:
                chunk = stream.read(min(remaining, 1024 * 1024))
                if not chunk: raise ValueError('媒体载荷截断')
                remaining -= len(chunk); digest.update(chunk)
            mdats.append(digest.hexdigest())
    return tracks, mdats
