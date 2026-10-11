import subprocess
from pathlib import Path
import pytest
from mutagen import File
from mutagen.id3 import TIT2, USLT, APIC
from mutagen.flac import Picture
from mutagen.mp4 import MP4Cover
from server.packaging import package_media, packet_hashes
from server.publishing import publish_stpp, stpp_tracks, extract_stpp

TTML=b'<tt xmlns="http://www.w3.org/ns/ttml"><body><p begin="0s" end="1s">synthetic</p></body></tt>'
LRC='[00:00.000]synthetic\n[00:01.000]\n'


@pytest.mark.parametrize('extension,codec',[('m4a','aac'),('mp3','libmp3lame'),('flac','flac')])
def test_preserves_media_tags_cover_and_lyrics(tmp_path,extension,codec):
    source=tmp_path/f'source.{extension}'; out=tmp_path/f'out.{extension}'
    subprocess.run(['ffmpeg','-v','error','-f','lavfi','-i','sine=duration=1','-c:a',codec,str(source)],check=True)
    media=File(source)
    if extension=='mp3':
        media.tags.add(TIT2(encoding=3,text=['title']))
        media.tags.add(USLT(encoding=3,lang='jpn',desc='other',text='preserve'))
        media.tags.add(APIC(encoding=3,mime='image/png',type=3,data=b'cover'))
    elif extension=='flac':
        media['TITLE']=['title']; p=Picture();p.data=b'cover';p.mime='image/png';p.type=3;media.add_picture(p)
    else: media['\xa9nam']=['title'];media['covr']=[MP4Cover(b'cover',imageformat=MP4Cover.FORMAT_PNG)]
    media.save()
    original=source.read_bytes()
    assert package_media(source,out,TTML if extension=='m4a' else None,LRC)['report']['passed']
    assert source.read_bytes()==original
    assert packet_hashes(source)==packet_hashes(out)
    if extension=='m4a':
        tracks=stpp_tracks(out); assert len(tracks)==1
        out2=tmp_path/'second.m4a'; package_media(out,out2,TTML.replace(b'synthetic',b'updated'),LRC,tracks[0]['track_id'])
        assert extract_stpp(out2,tracks[0]['track_id'])==TTML.replace(b'synthetic',b'updated')
        assert len(stpp_tracks(out2))==1
        with pytest.raises(ValueError): package_media(out,out2,TTML,LRC,999)


def test_two_stpp_tracks_preserves_unselected_sample(tmp_path):
    from server.publishing import _scan_top,_read_payload,_stpp_track,_box,_movie_clock
    import struct
    source=tmp_path/'source.m4a'; first=tmp_path/'first.m4a'; output=tmp_path/'output.m4a'
    subprocess.run(['ffmpeg','-v','error','-f','lavfi','-i','sine=duration=1','-c:a','aac',str(source)],check=True)
    publish_stpp(source,TTML,first)
    item=next(x for x in _scan_top(first) if x[0]==b'moov')
    moov=_read_payload(first,*item[1:]); timescale,_=_movie_clock(moov)
    sample=TTML.replace(b'synthetic',b'untouched')
    track=_stpp_track(len(sample),first.stat().st_size+8,99,1000,timescale)
    with first.open('r+b') as f:
        f.seek(item[1]);f.write(_box(b'free',b'\0'*(item[2]-8)))
        f.seek(0,2);f.write(_box(b'mdat',sample));f.write(_box(b'moov',moov+track))
    assert len(stpp_tracks(first))==2
    package_media(first,output,TTML.replace(b'synthetic',b'updated'),LRC,2)
    assert extract_stpp(output,99)==sample
    assert extract_stpp(output,2)==TTML.replace(b'synthetic',b'updated')


@pytest.mark.parametrize('part,message', [('audio', '音频载荷'), ('other', '原始媒体数据')])
def test_final_mp4_verification_rejects_corruption_after_tag_write(tmp_path, monkeypatch, part, message):
    from mutagen.mp4 import MP4
    from server.publishing import _box, _scan_top
    source, output = tmp_path/'source.m4a', tmp_path/'output.m4a'
    subprocess.run(['ffmpeg','-v','error','-f','lavfi','-i','sine=duration=1','-c:a','aac',str(source)],check=True)
    # This original mdat has bytes outside the audio packet set.
    with source.open('ab') as file:
        file.write(_box(b'mdat', b'preserved auxiliary media'))
    save = MP4.save
    def corrupt_after_save(self, *args, **kwargs):
        result = save(self, *args, **kwargs)
        mdats = [box for box in _scan_top(output) if box[0] == b'mdat']
        _, offset, _, header = mdats[0 if part == 'audio' else 1]
        with output.open('r+b') as file:
            file.seek(offset + header)
            byte = file.read(1)
            file.seek(offset + header)
            file.write(bytes([byte[0] ^ 1]))
        return result
    monkeypatch.setattr(MP4, 'save', corrupt_after_save)
    with pytest.raises(ValueError, match=message):
        package_media(source, output, TTML, LRC)
