import pytest
from mutagen import File
from mutagen.id3 import TIT2, USLT, APIC
from mutagen.flac import Picture
from mutagen.mp4 import MP4Cover
from server.packaging import package_media, packet_hashes
from server.publishing import (
    extract_stpp,
    make_box,
    movie_clock,
    publish_stpp,
    read_box_payload,
    scan_top,
    stpp_track,
    stpp_tracks,
)

TTML=b'<tt xmlns="http://www.w3.org/ns/ttml"><body><p begin="0s" end="1s">synthetic</p></body></tt>'
LRC='[00:00.000]synthetic\n[00:01.000]\n'


@pytest.mark.parametrize('extension,codec',[('m4a','aac'),('mp3','libmp3lame'),('flac','flac')])
def test_preserves_media_tags_cover_and_lyrics(tmp_path,synthetic_audio,extension,codec):
    source=synthetic_audio(tmp_path/f'source.{extension}',codec=codec,extension=extension)
    out=tmp_path/f'out.{extension}'
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
        out_lrc_only=tmp_path/'lrc-only.m4a'; rep=package_media(source,out_lrc_only,None,LRC)
        assert rep['report']['passed'] and rep['report']['subtitle_codec'] is None and stpp_tracks(out_lrc_only)==[]
        assert File(out_lrc_only)['\xa9lyr']==[LRC]
        with pytest.raises(ValueError): package_media(out,out2,None,None)
        with pytest.raises(ValueError): package_media(out,out2,TTML,LRC,999)


def test_two_stpp_tracks_preserves_unselected_sample(tmp_path,synthetic_audio):
    source=synthetic_audio(codec='aac',extension='m4a')
    first=tmp_path/'first.m4a'; output=tmp_path/'output.m4a'
    publish_stpp(source,TTML,first)
    item=next(x for x in scan_top(first) if x[0]==b'moov')
    moov=read_box_payload(first,*item[1:]); timescale,_=movie_clock(moov)
    sample=TTML.replace(b'synthetic',b'untouched')
    track=stpp_track(len(sample),first.stat().st_size+8,99,1000,timescale)
    with first.open('r+b') as f:
        f.seek(item[1]);f.write(make_box(b'free',b'\0'*(item[2]-8)))
        f.seek(0,2);f.write(make_box(b'mdat',sample));f.write(make_box(b'moov',moov+track))
    assert len(stpp_tracks(first))==2
    package_media(first,output,TTML.replace(b'synthetic',b'updated'),LRC,2)
    assert extract_stpp(output,99)==sample
    assert extract_stpp(output,2)==TTML.replace(b'synthetic',b'updated')


@pytest.mark.parametrize('part,message', [('audio', '音频载荷'), ('other', '原始媒体数据')])
def test_final_mp4_verification_rejects_corruption_after_tag_write(tmp_path, monkeypatch, synthetic_audio, part, message):
    from mutagen.mp4 import MP4
    source = synthetic_audio(tmp_path/'source.m4a', codec='aac', extension='m4a')
    output = tmp_path/'output.m4a'
    # This original mdat has bytes outside the audio packet set.
    with source.open('ab') as file:
        file.write(make_box(b'mdat', b'preserved auxiliary media'))
    save = MP4.save
    def corrupt_after_save(self, *args, **kwargs):
        result = save(self, *args, **kwargs)
        mdats = [box for box in scan_top(output) if box[0] == b'mdat']
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
