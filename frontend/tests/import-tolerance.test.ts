import file from './fixtures/external-overflow.ttml?raw';
import {expect,it} from 'vitest';
import {importLyricFile,exportLyricFile} from '../src/adapters/lyric-formats';
import {importedWarnings} from '../src/adapters/import-warnings';
import {parseLyricTtml,serializeLyricTtml} from '../src/adapters/ttml/lyric-codec';
it('preserves all 62 external lines and warns once while strict parsing still rejects overflow',()=>{
 const document=importLyricFile(file,'ttml');
 expect(document.lines).toHaveLength(62);
 expect(importedWarnings.get(document)).toEqual([{key:'import.childOutside',count:1}]);
 expect(()=>parseLyricTtml(file)).toThrow();
 const exported=importLyricFile(exportLyricFile(document,'ttml'),'ttml');
 expect(exported.lines[61].words.map(word=>[word.beginMs,word.endMs])).toEqual(document.lines[61].words.map(word=>[word.beginMs,word.endMs]));
 expect(parseLyricTtml(serializeLyricTtml(document,{draft:true}),{draft:true}).lines).toEqual(document.lines);
});
it('summarizes ignored styling, attributes and unknown roles, repairs duplicate IDs and singers',()=>{
 const document=importLyricFile('<tt xmlns="http://www.w3.org/ns/ttml" xmlns:tts="http://www.w3.org/ns/ttml#styling" xmlns:ttm="http://www.w3.org/ns/ttml#metadata"><head><styling><style xml:id="red"/></styling><layout/></head><body><div><p xml:id="a" ttm:agent="v1" style="red"><span tts:color="red" ttm:role="unknown">字</span></p><p xml:id="a">词</p></div></body></tt>','ttml');
 expect(new Set(document.lines.map(line=>line.id)).size).toBe(2);
 expect(document.agents[0].id).toBe('v1');
 expect(importedWarnings.get(document)).toEqual(expect.arrayContaining([{key:'import.ignoredElement',count:2},{key:'import.ignoredAttribute',count:2},{key:'import.ignoredRole',count:1},{key:'import.duplicateId',count:1},{key:'import.unknownAgent',count:1}]));
});
it.each(['<!DOCTYPE tt><tt/>','<tt','<wrong/>','<tt xmlns="http://www.w3.org/ns/ttml"/>'])('rejects unrecoverable XML %s',xml=>expect(()=>importLyricFile(xml,'ttml')).toThrow());
it.each([['elrc','[00:02.00]字<00:01.00>'],['yrc','[2000,-1000](2000,-1000,0)字'],['qrc','[2000,-1000]字(2000,-1000)'],['lys','[1]字(2000,-1000)']] as const)('keeps reversed %s endpoints', (format,text)=>{
 const d=importLyricFile(text,format);expect(d.lines[0].words[0].beginMs).toBe(2000);expect(d.lines[0].words[0].endMs).toBe(1000);expect(importedWarnings.get(d)?.some(w=>w.key==='import.reversed')).toBe(true);expect(()=>exportLyricFile(d,'yrc')).toThrow();
});

it('keeps empty internal drafts readable while rejecting empty external lyrics',()=>{
 const xml='<tt xmlns="http://www.w3.org/ns/ttml"><body/></tt>';
 expect(parseLyricTtml(xml,{draft:true}).lines).toHaveLength(0);
 expect(()=>importLyricFile(xml,'ttml')).toThrow();
});
