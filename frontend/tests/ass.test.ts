import { expect, it } from 'vitest';
import { createLine, createLyricDocument, createWord } from '../src/domain/lyric-document';
import { exportLyricFile } from '../src/adapters/lyric-formats';
import { collectOutputIssues } from '../src/adapters/output-validation';
const unit=(text:string,beginMs:number|null,endMs:number|null)=>({...createWord(text),beginMs,endMs});
function fixture(){const d=createLyricDocument();d.lines[0].beginMs=1000;d.lines[0].endMs=5000;d.lines[0].words=[unit('A',1234,1506),unit(' ',null,null),unit('B',2004,2406)];return d;}
it('uses line bounds, absolute centisecond endpoints, empty gaps and k without mutating the document',()=>{
 const d=fixture(),before=structuredClone(d),out=exportLyricFile(d,'ass');expect(d).toEqual(before);
 expect(out).toContain('ScriptType: v4.00+');expect(out).toContain('[V4+ Styles]');expect(out).toContain('Format: Layer, Start, End');
 expect(out).toContain('0:00:01.00,0:00:05.00,Main');expect(out).toContain('{\\k23}\u2060{\\k28}A {\\k49}\u2060{\\k41}B');expect(out).not.toContain('\\kf');
});
it('outputs all plain/timed translation and romanization contents, including matching body units and background',()=>{
 const d=fixture(),l=d.lines[0];const bg={...createLine('BG'),beginMs:1100,endMs:4200,backgroundOf:l.id,words:[unit('BG',1200,4000)]};d.lines.push(bg);
 d.translationTracks=[{id:'t',language:'en',purpose:'replacement',contents:[{id:'c1',lineId:l.id,kind:'plain',text:'one'},{id:'c2',lineId:l.id,kind:'plain',text:'two'},{id:'c3',lineId:bg.id,kind:'timed',units:[unit('outside',500,750),unit('  ',null,null),unit('end',6000,6500)]}]}];
 d.romanizationTracks=[{id:'r1',language:'en',contents:[{id:'r1c',lineId:l.id,kind:'timed',units:l.words.map(w=>({...w,text:w.text==='A'?'roman-a':w.text}))}]},{id:'r2',language:'en',contents:[{id:'r2c',lineId:l.id,kind:'plain',text:'roman-other'}]}];
 const out=exportLyricFile(d,'ass'),events=out.split('\n').filter(l=>l.startsWith('Dialogue:'));
 expect(events).toHaveLength(7);expect(out).toContain('Translation 1.2 en replacement');expect(out).toContain('Romanization 2.1 en');expect(out).toContain('roman-a');expect(out).toContain('roman-other');expect(out).not.toContain('one / two');expect(out).toContain('0:00:00.50,0:00:06.50,Translation');
 const positions=events.map(l=>l.match(/\\pos\(960,(\d+)\)/)![1]);expect(new Set(positions).size).toBe(7);
});
it('blocks ASS-specific overlaps, reversed units and attachments with missing timing at their actual IDs',()=>{
 const d=fixture();d.translationTracks=[{id:'t',language:null,purpose:'subtitle',contents:[{id:'c',lineId:d.lines[0].id,kind:'timed',units:[unit('A',100,900),{...unit('B',500,null),id:'bad'}]}]}];
 expect(collectOutputIssues(d,'ass')).toEqual(expect.arrayContaining([expect.objectContaining({kind:'translation-unit',trackId:'t',contentId:'c',unitId:'bad',missing:['end']})]));
 expect(collectOutputIssues(d,'qrc')).toEqual([]);
 const c=d.translationTracks[0].contents[0];if(c.kind!=='timed')throw Error();c.units[1].endMs=1000;
 expect(collectOutputIssues(d,'ass')).toEqual(expect.arrayContaining([expect.objectContaining({unitId:'bad',code:'unsupported-order'})]));
 c.units[1].beginMs=900;expect(collectOutputIssues(d,'ass')).toEqual([]);
 d.lines[0].words[0].beginMs=900;expect(collectOutputIssues(d,'ass').some(i=>i.wordId===d.lines[0].words[0].id&&i.code==='invalid-range')).toBe(true);
});
it('keeps short units as k0 and avoids cumulative drift on a long sequence',()=>{
 const d=fixture();d.lines[0].words=Array.from({length:1000},(_,i)=>unit('x',1000+i*3,1003+i*3));
 const out=exportLyricFile(d,'ass');expect(out).toContain('{\\k0}x');
 expect([...out.matchAll(/\\k(\d+)/g)].reduce((sum,m)=>sum+Number(m[1]),0)).toBe(300);
});
it('escapes literal effect syntax, keeps visible slash sequences and maps actual newlines only',()=>{
 const d=fixture();d.lines[0].words=[unit('A{\\k999}\\N\\n\\h,\nB',1000,2000)];
 const out=exportLyricFile(d,'ass');expect(out).toContain('A\\{\\\u2060k999\\}\\\u2060N\\\u2060n\\\u2060h,\\NB');
 expect(out.split('\n').filter(l=>l.startsWith('Dialogue:'))).toHaveLength(1);
});
it('rejects collapsed event bounds and missing timing but permits zero duration words within a valid event',()=>{
 const d=fixture();d.lines[0].words=[unit('x',1000,1000)];expect(()=>exportLyricFile(d,'ass')).not.toThrow();
 d.lines[0].endMs=1001;expect(collectOutputIssues(d,'ass').some(i=>i.kind==='line'&&i.code==='invalid-range')).toBe(true);
});
