import { expect, it } from 'vitest';
import { createLyricDocument, createWord, type LyricDocument } from '../src/domain/lyric-document';
import { exportLyricFile, importLyricFile } from '../src/adapters/lyric-formats';
import { collectOutputIssues } from '../src/adapters/output-validation';
import { projectExportSeparators } from '../src/adapters/export-separators';
import { serializeLyricTtml, parseLyricTtml } from '../src/adapters/ttml/lyric-codec';
const word = (text: string, beginMs: number | null = null, endMs: number | null = null) => ({ ...createWord(text), beginMs, endMs });
function fixture() {
 const doc = createLyricDocument(); const line = doc.lines[0]; line.beginMs = 1000; line.endMs = 3000;
 line.words = [word(' \u3000'), word('A',1000,1400),word(' '),word('\u00a0'),word('B',2000,2500),word('  ')]; return doc;
}
it('attaches a copy within each line, preserving exact text and host endpoints', () => {
 const doc=fixture(), before=structuredClone(doc), result=projectExportSeparators(doc.lines[0].words);
 expect(result.unhosted).toEqual([]); expect(result.units.map(w=>[w.text,w.beginMs,w.endMs])).toEqual([[' \u3000A \u00a0',1000,1400],['B  ',2000,2500]]);
 expect(doc).toEqual(before);
});
it.each(['eslrc','qrc','yrc','lys','ass'] as const)('%s serializes horizontal separators and isolates source data', format=>{
 const doc=fixture(), before=structuredClone(doc);
 const background=structuredClone(doc.lines[0]); background.id='background'; background.backgroundOf=doc.lines[0].id; background.words.forEach(w=>w.id+='bg'); doc.lines.push(background); before.lines.push(structuredClone(background));
 expect(collectOutputIssues(doc,format)).toEqual([]);
 const output=exportLyricFile(doc,format); expect(output).toContain(' \u3000A \u00a0'); expect(output).toContain('B  '); expect(doc).toEqual(before);
 if(format==='qrc'||format==='yrc') { expect(output).toContain('（ \u3000A'); expect(output).toContain('B  ）'); }
});
it.each(['eslrc','qrc','yrc','lys','ass'] as const)('%s rejects no host, missing text, partial/semantic spaces and control whitespace',format=>{
 const doc=fixture();
 for(const words of [[word(' ')],[word('A'),word(' '),word('B',2000,2500)],[word(' ',1000)],[word('')],[{...word(' '),emptyBeat:1}],[{...word(' '),rubyUnits:[{id:'r',reading:'a',beginMs:null,endMs:null}]}],[word('\t',1000,2000)],[word('\n',1000,2000)],[word('。')]]) {
  if (format === 'ass' && words[0].text === '\n') continue;
  doc.lines[0].words=words; expect(collectOutputIssues(doc,format).length).toBeGreaterThan(0); expect(()=>exportLyricFile(doc,format)).toThrow();
 }
 doc.lines[0].words=[word(' ')]; expect(()=>exportLyricFile(doc,'txt')).not.toThrow(); expect(()=>exportLyricFile(doc,'lrc')).not.toThrow();
 expect(collectOutputIssues(doc,format).some(i=>i.message.includes('该行没有可输出的定时正文'))).toBe(true);
});
it.each(['qrc','yrc'] as const)('%s preserves explicit timed spaces including the last background word', format=>{
 const doc=fixture();doc.lines[0].words=[word('A',1000,1500),word(' ',1600,1700)];
 const bg=structuredClone(doc.lines[0]);bg.id='bg';bg.backgroundOf=doc.lines[0].id;doc.lines.push(bg);
 const out=exportLyricFile(doc,format);expect(out).toContain('1600,100');expect(out).toContain('）');
 const result=importLyricFile(out,format);expect(result.lines[0].words.map(w=>[w.text,w.beginMs,w.endMs])).toEqual([['A',1000,1500],[' ',1600,1700]]);
});
it('preserves timed translation separators in draft and final TTML, without flattening timing',()=>{
 const doc=fixture();doc.translationTracks=[{id:'t',language:'en',purpose:'replacement',contents:[{id:'c',lineId:doc.lines[0].id,kind:'timed',units:[word(' '),word('One',500,800),word('\u3000\u00a0'),word('Two',3500,4000),word(' ')].map(({id,text,beginMs,endMs})=>({id,text,beginMs,endMs}))}]}];
 expect(collectOutputIssues(doc,'ttml')).toEqual([]);
 const summary=(d:LyricDocument)=>d.translationTracks.map(t=>[t.language,t.purpose,t.contents.map(c=>c.kind==='timed'?c.units.map(u=>[u.text,u.beginMs,u.endMs]):c.text)]);
 expect(parseLyricTtml(serializeLyricTtml(doc,{draft:true}))).toEqual(doc);
 expect(summary(parseLyricTtml(exportLyricFile(doc,'ttml')))).toEqual(summary(doc));
});
