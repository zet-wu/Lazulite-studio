import { expect, it } from 'vitest';
import { createLyricDocument, createWord } from '../src/domain/lyric-document';
import { createProjectDocument } from '../src/domain/project-document';
import { outputId, autoInsertCues } from '../src/domain/karaoke';
import { prepareSug, sugZip } from '../src/adapters/sug';
import { writeFileSync } from 'node:fs';
function fixture(){const p=createProjectDocument(createLyricDocument('明日'));Object.assign(p.lyrics.lines[0].words[0],{beginMs:1003,endMs:2009,rubyUnits:[{id:'r1',reading:'あ',beginMs:1100,endMs:1300},{id:'r2',reading:'した',beginMs:1600,endMs:1900}]});return p;}
const data=(p:ReturnType<typeof fixture>)=>JSON.parse(prepareSug(p,'曲').files[0].text);
it('exports native Unicode, ruby boundaries, pauses, guides and shared offset without source mutations',()=>{
 const p=fixture();p.karaoke.defaults.rubyMs=100;p.karaoke=autoInsertCues(p.lyrics,p.karaoke);p.karaoke.offsets[outputId('main')]=50;
 const before=structuredClone(p),r=prepareSug(p,'曲');expect(r.issues).toEqual([]);expect(p).toEqual(before);
 const d=data(p),chars=d.sentences[0].characters;expect(d.global_offset_ms).toBe(50);expect(chars[0].timestamps[0]).toBe(1003);expect(chars.at(-1).sentence_end_ts).toBe(2009);expect(chars[0].ruby.parts.at(-1).text).toBe('した');
 if(process.env.SUG_CONTRACT_DIR){writeFileSync(`${process.env.SUG_CONTRACT_DIR}/actual.zip`,sugZip(p,'曲'));writeFileSync(`${process.env.SUG_CONTRACT_DIR}/actual.sug`,r.files[0].text);}
});
it('preserves independent zero-length separator checkpoints and blocks unhosted or invalid words',()=>{
 const p=fixture(),line=p.lyrics.lines[0];line.words.unshift(createWord('  '));line.words.push(createWord('　'));const r=prepareSug(p,'s');expect(r.issues).toEqual([]);const c=data(p).sentences[0].characters;expect(c[0].timestamps).toEqual([1003]);expect(c[1].sentence_end_ts).toBe(1003);expect(c.at(-1).sentence_end_ts).toBe(2009);
 line.words[1].beginMs=null;expect(prepareSug(p,'s').issues.some(i=>i.code==='missing-time')).toBe(true);
});
it('allows monotonic overlap, blocks reversed starts and truncated line envelopes',()=>{
 const p=fixture(),l=p.lyrics.lines[0];l.words[0].rubyUnits=[];l.words.push({...createWord('次'),beginMs:1800,endMs:2500});expect(prepareSug(p,'s').issues).toEqual([]);
 l.words[1].endMs=1900;expect(prepareSug(p,'s').issues.some(i=>i.code==='unsupported-order')).toBe(true);
 l.words[1].beginMs=900;expect(prepareSug(p,'s').issues.some(i=>i.code==='unsupported-order')).toBe(true);
});
it('blocks clipping and overflow, allows exactly zero; ignores marker image settings',()=>{
 const p=fixture();p.karaoke.offsets[outputId('main')]=-1003;expect(prepareSug(p,'s').issues).toEqual([]);p.karaoke.offsets[outputId('main')]=-1004;expect(prepareSug(p,'s').issues.some(i=>i.message.includes('输出偏移'))).toBe(true);p.karaoke.offsets[outputId('main')]=Number.MAX_SAFE_INTEGER;expect(()=>sugZip(p,'s')).toThrow();
});
it('selected timed auxiliary is independent of broken body ruby and preserves per-unit times',()=>{
 const p=fixture(),l=p.lyrics.lines[0];l.words[0].beginMs=null;p.lyrics.translationTracks=[{id:'t',language:null,purpose:'subtitle',contents:[{id:'c',lineId:l.id,kind:'timed',units:[{id:'u',text:'明天',beginMs:1001,endMs:2011}]}]}];p.karaoke.outputs=[outputId('main','translation','t')];expect(prepareSug(p,'s').issues).toEqual([]);expect(data(p).metadata.language).toBe('');expect(data(p).sentences[0].characters.at(-1).sentence_end_ts).toBe(2011);
 p.lyrics.translationTracks[0].contents=[{id:'c',lineId:l.id,kind:'plain',text:'明天'}];expect(prepareSug(p,'s').issues.some(i=>i.kind==='word')).toBe(true);
});
it('canonicalizes chorus roles, disambiguates names and assigns unspecified explicitly',()=>{
 const p=fixture(),l=p.lyrics.lines[0];p.lyrics.agents=[{id:'a',name:'同名',type:'person'},{id:'b',name:'同名',type:'person'}];l.agentRefs=['a','b'];l.words.push({...createWord('次'),beginMs:2100,endMs:2200,agentRefs:['b','a']});const d=data(p);expect(d.singers).toHaveLength(2);expect(d.sentences[0].characters.every((c:{singer_id:string})=>c.singer_id==='singer-1')).toBe(true);
});
