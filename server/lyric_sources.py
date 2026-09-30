"""Fixed-provider, authenticated lyric transport. No semantic lyric conversion."""
import base64
import html
import json
import re
import threading
import zlib
from typing import Literal
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
import httpx

Source = Literal['netease', 'qqmusic', 'kugou', 'amll']
AMLL_BASE = 'https://amlldb.bikonoo.com'
MAX_BYTES = 4_000_000
KRC_KEY = b'@Gaw^2tGQ61-\xce\xd2ni'
QRC_KEY = b'!@#)(*$%123ZXC!@!@#)(NHL'


def inflate(data):
    decoder = zlib.decompressobj()
    result = decoder.decompress(data, MAX_BYTES + 1)
    if len(result) > MAX_BYTES or not decoder.eof:
        raise ValueError('歌词解压超限或压缩内容不完整')
    return result.decode('utf-8')


def decode_krc(data):
    if not data.startswith(b'krc1'):
        raise ValueError('KRC 文件头无效')
    return inflate(bytes(v ^ KRC_KEY[i % 16] for i, v in enumerate(data[4:])))


def decode_qq(value):
    if not value:
        return ''
    if re.fullmatch(r'[0-9a-fA-F]+', value):
        from .vendor.qrc_des import DECRYPT, tripledes_key_setup, tripledes_crypt
        raw = bytes.fromhex(value)
        if len(raw) % 8 or len(raw) > 500_000:
            raise ValueError('QRC 载荷长度无效')
        schedule = tripledes_key_setup(QRC_KEY, DECRYPT)
        value = inflate(b''.join(tripledes_crypt(bytearray(raw[i:i+8]), schedule) for i in range(0, len(raw), 8)))
    elif not value.lstrip().startswith(('[', '<')):
        value = base64.b64decode(value, validate=True).decode('utf-8')
    attr = re.search(r'LyricContent="([\s\S]*?)"(?:\s|/?>)', value)
    return html.unescape(attr[1] if attr else value)


class Search(BaseModel):
    model_config = ConfigDict(extra='forbid')
    source: Source
    query: str = Field(min_length=1, max_length=200)


class Candidate(BaseModel):
    model_config = ConfigDict(extra='forbid')
    source: Source
    id: str = Field(min_length=1, max_length=160, pattern=r'^[\w.:-]+$')
    title: str = Field(default='', max_length=500)
    artists: list[str] = Field(default_factory=list, max_length=30)
    album: str = Field(default='', max_length=500)
    duration_ms: int | None = Field(default=None, ge=0)
    songmid: str | None = Field(default=None, max_length=60, pattern=r'^[A-Za-z0-9]+$')
    songid: str | None = Field(default=None, pattern=r'^\d+$', max_length=30)
    platform: Literal['ncm-lyrics', 'qq-lyrics', 'apple-lyrics', 'spotify-lyrics', 'raw-lyrics', 'ttml'] | None = None
    file: str | None = Field(default=None, max_length=180, pattern=r'^[A-Za-z0-9_-]+\.ttml$')


class Sources:
    def __init__(self, transport=None):
        self.transport = transport
        self.limits = {s: threading.BoundedSemaphore(3) for s in ('netease', 'qqmusic', 'kugou', 'amll')}

    def request(self, url, *, params=None, body=None, text=False):
        with httpx.Client(timeout=18, transport=self.transport, follow_redirects=False, headers={'User-Agent': 'Mozilla/5.0', 'Referer': 'https://y.qq.com/' if 'qq.com' in url else 'https://music.163.com/' if '163.com' in url else 'https://www.kugou.com/'}) as client:
            with client.stream('POST' if body is not None else 'GET', url, params=params, json=body) as response:
                response.raise_for_status()
                chunks, size = [], 0
                for chunk in response.iter_bytes():
                    size += len(chunk)
                    if size > MAX_BYTES: raise ValueError('来源响应超过 4 MB')
                    chunks.append(chunk)
                raw = b''.join(chunks).decode('utf-8')
        return raw if text else json.loads(raw)

    def search(self, source, query):
        if source == 'netease':
            data = self.request('https://music.163.com/api/search/get/web', params={'s': query, 'type': 1, 'offset': 0, 'limit': 20})
            if data.get('code', 200) != 200: raise ValueError(f"网易云搜索失败：{data.get('code')}")
            return [Candidate(source=source, id=str(s['id']), title=s['name'], artists=[a['name'] for a in s.get('ar', s.get('artists', []))], album=s.get('al', s.get('album', {})).get('name', ''), duration_ms=s.get('dt', s.get('duration'))) for s in data.get('result', {}).get('songs', [])]
        if source == 'qqmusic':
            data = self.request('https://c.y.qq.com/splcloud/fcgi-bin/smartbox_new.fcg', params={'format':'json', 'key':query})
            if data.get('code', 0) != 0: raise ValueError(f"QQ 搜索失败：{data.get('code')}")
            return [Candidate(source=source, id=str(s.get('mid') or s['id']), songmid=s.get('mid') or None, songid=str(s['id']) if s.get('id') else None, title=s['name'], artists=[s.get('singer','')], album=s.get('albumname','')) for s in data.get('data',{}).get('song',{}).get('itemlist',[])]
        if source == 'kugou':
            data = self.request('https://mobiles.kugou.com/api/v3/search/song', params={'format':'json','keyword':query,'page':1,'pagesize':20,'showtype':14,'plat':0,'sver':5,'correct':1,'api_ver':1,'version':9108})
            if data.get('status', 1) != 1: raise ValueError('酷狗搜索失败')
            return [Candidate(source=source, id=s['hash'], title=s.get('songname',''), artists=[s.get('singername','')], album=s.get('album_name',''), duration_ms=s.get('duration',0)*1000) for s in data.get('data',{}).get('info',[])]
        data = self.request(AMLL_BASE+'/api/search-lyrics', body={'query':query,'type':'all'})
        if not isinstance(data, list): raise ValueError('AMLL 搜索响应格式错误')
        result = []
        for s in data[:30]:
            platform, file = s.get('platform'), s.get('file')
            if not platform or not file: continue
            result.append(Candidate(source=source,id=f'{platform}:{file}',platform=platform,file=file,title=s.get('title') or (s.get('titles') or [query])[0],artists=s.get('artists') or [s.get('artist','')],album=(s.get('albums') or [''])[0]))
        return result

    def resolve(self, candidate):
        if candidate.source == 'qqmusic' and not candidate.songmid and candidate.songid:
            data = self.request('https://u.y.qq.com/cgi-bin/musicu.fcg', body={'req_0':{'module':'music.pf_song_detail_svr','method':'get_song_detail_yqq','param':{'song_id':int(candidate.songid)}},'comm':{'format':'json','ct':24}})
            mid = data.get('req_0',{}).get('data',{}).get('track_info',{}).get('mid')
            if mid: return Candidate(**{**candidate.model_dump(), 'songmid': mid})
        return candidate

    def fetch(self, c):
        metadata = {k: v for k,v in {'title':[c.title] if c.title else [], 'artist':c.artists, 'album':[c.album] if c.album else []}.items() if v}
        extra = {}
        if c.source == 'netease':
            if not c.id.isdigit(): raise ValueError('网易云歌曲 ID 必须为数字字符串')
            r = self.request('https://music.163.com/api/song/lyric', params={'id':c.id,'lv':-1,'kv':-1,'tv':-1,'rv':-1,'yv':-1})
            if r.get('code',200) != 200: raise ValueError(f"网易云取词失败：{r.get('code')}")
            kind = 'yrc' if r.get('yrc',{}).get('lyric') else 'lrc'
            content = r.get(kind,{}).get('lyric','')
            extra = {'translation':(r.get('ytlrc' if kind == 'yrc' else 'tlyric') or r.get('tlyric') or {}).get('lyric',''), 'romanization':(r.get('yromalrc' if kind == 'yrc' else 'romalrc') or r.get('romalrc') or {}).get('lyric','')}
            metadata['ncmMusicId'] = [c.id]
        elif c.source == 'qqmusic':
            c = self.resolve(c)
            r = self.request('https://u.y.qq.com/cgi-bin/musicu.fcg', body={'req_0':{'module':'music.musichallSong.PlayLyricInfo','method':'GetPlayLyricInfo','param':{'songMID':c.songmid or '', 'songID':int(c.songid or '0'), 'crypt':1,'type':1,'lrc_t':0,'qrc':1,'qrc_t':0,'trans':1,'trans_t':0,'roma':1,'roma_t':0}},'loginUin':'0','comm':{'uin':'0','format':'json','ct':24,'cv':0}})
            if r.get('code') != 0 or r.get('req_0',{}).get('code') != 0: raise ValueError('QQ 取词请求失败')
            r = r['req_0'].get('data',{})
            content = decode_qq(r.get('lyric'))
            if not content and c.songmid:
                r = self.request('https://i.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg', params={'songmid':c.songmid,'format':'json','nobase64':1},)
                if r.get('retcode',r.get('code',0)) != 0: raise ValueError('QQ 逐行取词失败')
                content = decode_qq(r.get('lyric'))
            kind = 'qrc' if re.search(r'^\[\d+,\d+\].*\(\d+,\d+\)',content,re.M) else 'lrc'
            extra = {'translation':decode_qq(r.get('trans')), 'romanization':decode_qq(r.get('roma'))}
            if c.songmid: metadata['qqMusicId'] = [c.songmid]
        elif c.source == 'kugou':
            r = self.request('https://lyrics.kugou.com/search', params={'ver':1,'man':'yes','client':'pc','keyword':c.title,'hash':c.id,'duration':c.duration_ms or ''})
            candidates = r.get('candidates',[])
            if not candidates: return {'empty':True}
            lyric = min(candidates,key=lambda x: abs(x.get('duration',0)-(c.duration_ms or 0)))
            r = self.request('https://lyrics.kugou.com/download',params={'ver':1,'client':'pc','id':str(lyric['id']),'accesskey':lyric['accesskey'],'fmt':'krc','charset':'utf8'})
            kind = 'lrc' if r.get('fmt','').lower() == 'lrc' else 'krc'
            raw = base64.b64decode(r.get('content',''),validate=True)
            content = decode_krc(raw) if kind == 'krc' else raw.decode('utf-8')
        else:
            if not c.platform or not c.file: raise ValueError('AMLL 候选缺少文件标识')
            kind, content = 'ttml', self.request(f'{AMLL_BASE}/{c.platform}/{c.file}',text=True)
            metadata = {}
        return {'empty': not bool(content.strip()), 'format':kind,'content':content,'metadata':metadata, **extra}


def build_sources_router(*, write, sources=None):
    sources = sources or Sources()
    router = APIRouter(prefix='/lyric-sources')
    def invoke(source, action):
        semaphore = sources.limits[source]
        if not semaphore.acquire(blocking=False): raise HTTPException(429, {'code':'source_busy','message':'此来源正在处理较多请求，请稍后重试','retryable':True})
        try: return action()
        except httpx.HTTPError as exc:
            raise HTTPException(502, {'code':'source_network','message':f'来源网络请求失败：{type(exc).__name__}','retryable':True}) from exc
        except (ValueError, KeyError, TypeError, zlib.error) as exc:
            raise HTTPException(502, {'code':'source_payload','message':str(exc),'retryable':True}) from exc
        finally: semaphore.release()
    @router.post('/search')
    def search(body: Search, _=Depends(write)):
        return invoke(body.source, lambda: {'items':[c.model_dump() for c in sources.search(body.source,body.query)]})
    @router.post('/fetch')
    def fetch(body: Candidate, _=Depends(write)):
        return invoke(body.source, lambda: sources.fetch(body))
    @router.post('/resolve')
    def resolve(body: Candidate, _=Depends(write)):
        return invoke(body.source, lambda: sources.resolve(body).model_dump())
    return router
