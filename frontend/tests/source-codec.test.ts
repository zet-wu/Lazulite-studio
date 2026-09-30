import { expect, it } from 'vitest';
import { importLyricFile } from '../src/adapters/lyric-formats';
import { parsePayload } from '../src/adapters/http/lyric-sources';
import { createLyricDocument } from '../src/domain/lyric-document';
import { defaultChoices, selectedMetadata } from '../src/features/LyricAcquisition';
it('keeps actual YRC/QRC/KRC word clocks and whitespace', () => {
 for (const [format, content] of [['yrc','[1000,1500](1000,500,0)甲 (2000,500,0)乙'],['qrc','[1000,1500]甲 (1000,500)乙(2000,500)'],['krc','[1000,1500]<0,500,0>甲 <1000,500,0>乙']] as const) {
   const d=importLyricFile(content,format); expect(d.lines[0].words.map(w=>[w.text,w.beginUs,w.endUs])).toEqual([['甲 ',1000000,1500000],['乙',2000000,2500000]]);
 }
});
it('does not invent ordinary LRC ends', () => { const d=importLyricFile('[00:01.00]甲\n[00:02.00]乙','lrc'); expect(d.lines.map(l=>l.endUs)).toEqual([null,null]); });
it('retains sidecar translation and real QRC romanization clocks', () => {
 const p=parsePayload({empty:false,format:'qrc',content:'[1000,500]甲(1000,500)',metadata:{qqMusicId:['mid']},translation:'[00:01]translation',romanization:'[1000,500]jia(1000,500)'});
 expect(p.document.lines[0].translations[0].text).toBe('translation'); expect(p.document.romanizationTracks[0].contents[0].kind).toBe('timed'); expect(p.badges).toContain('音译');
});
it('selects entire metadata lists and permits empty-side deletion', () => {
 const a={...createLyricDocument(), metadata:{artists:[' A ','B'],album:['old'],only:['x']}}, b={...createLyricDocument(),metadata:{artists:['C'],album:['new'],incoming:['y']}};
 const choices=defaultChoices(a,b); expect(choices.artists).toBe('current'); expect(choices.incoming).toBe('incoming');
 expect(selectedMetadata(a,b,{...choices,only:'incoming'})).toEqual({artists:[' A ','B'],album:['old'],incoming:['y']});
});
