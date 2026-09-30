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
