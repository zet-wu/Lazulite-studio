import { expect, it } from 'vitest';
import { importLyricFile } from '../src/adapters/lyric-formats';
import { parsePayload } from '../src/adapters/http/lyric-sources';
import { createLyricDocument } from '../src/domain/lyric-document';
import { defaultChoices, selectedMetadata } from '../src/features/LyricAcquisition';
it('keeps actual YRC/QRC/KRC word clocks and whitespace', () => {
 for (const [format, content] of [['yrc','[1000,1500](1000,500,0)甲 (2000,500,0)乙'],['qrc','[1000,1500]甲 (1000,500)乙(2000,500)'],['krc','[1000,1500]<0,500,0>甲 <1000,500,0>乙']] as const) {
   const d=importLyricFile(content,format); expect(d.lines[0].words.map(w=>[w.text,w.beginMs,w.endMs])).toEqual([['甲 ',1000,1500],['乙',2000,2500]]);
 }
});
it('does not invent ordinary LRC ends', () => { const d=importLyricFile('[00:01.00]甲\n[00:02.00]乙','lrc'); expect(d.lines.map(l=>l.endMs)).toEqual([null,null]); });
it('retains sidecar translation and real QRC romanization clocks', () => {
 const p=parsePayload({empty:false,format:'qrc',content:'[1000,500]甲(1000,500)',metadata:{qqMusicId:['mid']},translation:'[00:01]translation',romanization:'[1000,500]jia(1000,500)'});
 expect((p.document.lines[0].translations[0] as { text: string }).text).toBe('translation'); expect(p.document.romanizationTracks[0].contents[0].kind).toBe('timed'); expect(p.badges).toContain('音译');
});
it('selects entire metadata lists and permits empty-side deletion', () => {
 const a={...createLyricDocument(), metadata:{artists:[' A ','B'],album:['old'],only:['x']}}, b={...createLyricDocument(),metadata:{artists:['C'],album:['new'],incoming:['y']}};
 const choices=defaultChoices(a,b); expect(choices.artists).toBe('current'); expect(choices.incoming).toBe('incoming');
 expect(selectedMetadata(a,b,{...choices,only:'incoming'})).toEqual({artists:[' A ','B'],album:['old'],incoming:['y']});
});
it('sidecar 750 ms matching is inclusive, monotonic, one to one and rejects same-start ambiguity',()=>{
 const p=parsePayload({empty:false,format:'qrc',content:'[1000,500]甲(1000,500)\n[3000,500]乙(3000,500)',metadata:{},translation:'[00:01.750]one\n[00:03.751]outside',romanization:'[1750,500]a(1750,500)'});
 expect(p.partial).toBe(true);expect((p.document.lines[0].translations[0] as { text: string }).text).toBe('one');expect(p.document.lines[1].translations).toEqual([]);
 const content=p.document.romanizationTracks[0].contents[0];expect(content.kind==='timed' && content.units[0].beginMs).toBe(1750);
 const ambiguous=parsePayload({empty:false,format:'qrc',content:'[1000,500]甲(1000,500)\n[1000,500]乙(1000,500)',metadata:{},translation:'[00:01]ambiguous'});
 expect(ambiguous.document.lines.every(l=>!l.translations.length)).toBe(true);expect(ambiguous.partial).toBe(true);
});
it('malformed optional blocks do not block body; malformed body and empty body still fail',()=>{
 const p=parsePayload({empty:false,format:'krc',content:'[language:broken]\n[1000,500]<0,500,0>甲',metadata:{},translation:'broken'});
 expect(p.document.lines).toHaveLength(1);expect(p.partial).toBe(true);expect(p.badges).toContain('KRC');
 expect(()=>parsePayload({empty:false,format:'qrc',content:'[1000,500]甲(1000,500)\nbroken body',metadata:{}})).toThrow('正文格式');
 expect(()=>parsePayload({empty:false,format:'lrc',content:'[00:01] ',metadata:{}})).toThrow('可用正文');
});
