import subprocess
import pytest
from mutagen import File
from mutagen.id3 import USLT
from server.embedded_lyrics import read_embedded, lyric_format
from server.publishing import publish_stpp

@pytest.mark.parametrize('text,kind', [('[00:01.000]line','lrc'),('[00:01.000]<00:01.000>a<00:02.000>b<00:03.000>','elrc'),('[00:01.000]a[00:02.000]b[00:03.000]','eslrc')])
def test_detects_actual_timing_syntax(text,kind):
    assert lyric_format(text) == kind

@pytest.mark.parametrize('extension,codec', [('mp3','libmp3lame'),('flac','flac'),('m4a','aac')])
def test_separate_original_tag_candidates(tmp_path,extension,codec):
    path=tmp_path/f'source.{extension}'
    subprocess.run(['ffmpeg','-v','error','-f','lavfi','-i','sine=duration=1','-c:a',codec,str(path)],check=True)
    media=File(path)
    texts=['[00:01.000]a','[00:01.000]<00:01.000>b<00:02.000>']
    if extension=='mp3':
        for i,text in enumerate(texts):media.tags.add(USLT(encoding=3,lang='eng',desc=str(i),text=text))
    else: media['lyrics' if extension=='flac' else '\xa9lyr']=texts
    media.save(); before=path.read_bytes()
    candidates=read_embedded(path)
    assert {c['content'] for c in candidates} == set(texts)
    assert {c['format'] for c in candidates} == {'lrc','elrc'}
    assert path.read_bytes()==before
    if extension=='m4a':
        output=tmp_path/'output.m4a'
        xml='<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" xmlns:amll="http://www.example.com/ns/amll"><body><p begin="0" end="1"><span begin="0" end="1" ttm:role="expletive" amll:obscene="true">word</span></p></body></tt>'
        publish_stpp(path,xml,output)
        candidates=read_embedded(output)
        assert len(candidates)==3
        assert candidates[-1]['content']==xml
        assert candidates[-1]['format']=='ttml'

def test_unknown_plain_structure_rejected():
    with pytest.raises(ValueError,match='不支持'):lyric_format('plain text')

def test_project_endpoint_reads_owned_original_without_changing_document(tmp_path):
    from server.tests.test_project_resources import client_for, HEADERS
    path=tmp_path/'source.flac'
    subprocess.run(['ffmpeg','-v','error','-f','lavfi','-i','sine=duration=1','-c:a','flac',str(path)],check=True)
    media=File(path);media['lyrics']=['[00:00.000]original'];media.save()
    with client_for(tmp_path) as client:
        pid=client.post('/api/v1/projects',json={'name':'embedded'},headers=HEADERS).json()['id']
        url=f'/api/v1/projects/{pid}'
        before=client.get(url+'/document').json()
        assert client.get(url+'/embedded-lyrics').status_code==422
        token=client.post('/api/v1/uploads',files={'file':('source.flac',path.read_bytes(),'audio/flac')},headers=HEADERS).json()['id']
        assert client.post(url+'/music',json={'upload_id':token},headers=HEADERS).status_code==200
        result=client.get(url+'/embedded-lyrics')
        assert result.status_code==200,result.text
        assert result.json()['candidates'][0]['content']=='[00:00.000]original'
        assert client.get(url+'/document').json()==before
        assert client.get('/api/v1/projects/absent/embedded-lyrics').status_code==404

def test_multi_sample_stpp_is_listed_as_unsupported_instead_of_first_sample(tmp_path):
    import struct
    source=tmp_path/'source.m4a';output=tmp_path/'output.m4a'
    subprocess.run(['ffmpeg','-v','error','-f','lavfi','-i','sine=duration=1','-c:a','aac',str(source)],check=True)
    publish_stpp(source,'<tt xmlns="http://www.w3.org/ns/ttml"><body/></tt>',output)
    data=bytearray(output.read_bytes());offset=data.rfind(b'stsz');struct.pack_into('>I',data,offset+12,2);output.write_bytes(data)
    candidates=read_embedded(output)
    assert len(candidates)==1
    assert '多 sample' in candidates[0]['error']
    assert 'content' not in candidates[0]
