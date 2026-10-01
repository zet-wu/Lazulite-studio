import { expect, it } from 'vitest';
import { createLyricDocument, createLine, createWord, lineText } from '../src/domain/lyric-document';
import { serializeLyricTtml, parseLyricTtml } from '../src/adapters/ttml/lyric-codec';
it('exports literal untimed whitespace text nodes, preserving edges and draft word identity', () => {
  const doc = createLyricDocument(); doc.lines[0].words = ['  ', 'A', ' \n ', 'B', '\t '].map((text, i) => ({ ...createWord(text, `w${i}`), beginUs: text.trim() ? i * 1e6 : null, endUs: text.trim() ? (i + 1) * 1e6 : null }));
  const before = structuredClone(doc);
  const xml = serializeLyricTtml(doc), parsed = new DOMParser().parseFromString(xml, 'application/xml');
  const nodes = Array.from(parsed.querySelector('p')!.childNodes);
  expect(nodes.map(node => node.nodeType)).toEqual([3, 1, 3, 1, 3]);
  expect(nodes[2].textContent).toBe(' \n ');
  expect(lineText(parseLyricTtml(xml).lines[0])).toBe(lineText(doc.lines[0]));
  expect(parseLyricTtml(serializeLyricTtml(doc, { draft: true })).lines[0].words).toEqual(doc.lines[0].words);
  expect(doc).toEqual(before);
});
it('keeps timed, partially timed and annotated whitespace spans with their own fields', () => {
  const doc = createLyricDocument();
  doc.lines[0].words = [
    { ...createWord(' ', 'timed'), beginUs: 1, endUs: 2 },
    { ...createWord(' ', 'partial'), beginUs: 3 },
    { ...createWord(' ', 'ruby'), rubyUnits: [{ id: 'r', reading: 'く', beginUs: null, endUs: null }] },
    { ...createWord(' ', 'beat'), emptyBeat: 1 },
    { ...createWord(' ', 'align'), alignmentUnits: [{ id: 'align', kind: 'word' as const, text: ' ', beginUs: null, endUs: null, readingStart: null, readingEnd: null, rubyUnitId: null }] },
  ];
  const xml = new DOMParser().parseFromString(serializeLyricTtml(doc), 'application/xml');
  expect(xml.querySelector('p')!.children).toHaveLength(5);
  expect(xml.querySelector('p')!.children[0].getAttribute('begin')).toBe('0.000001');
  expect(xml.querySelector('p')!.children[1].hasAttribute('end')).toBe(false);
});
it('pure transliteration emits only fully untimed whitespace as text, keeping internal units',()=>{
 const d=createLyricDocument(); const line=createLine('正文'); line.beginUs=0;line.endUs=2000000;d.lines=[line];
 d.romanizationTracks=[{id:'track',language:'ja-Latn',contents:[{id:'content',lineId:line.id,kind:'timed',units:[
 {id:'u1',text:'a',beginUs:0,endUs:1000000}, {id:'space',text:'  ',beginUs:null,endUs:null},{id:'u2',text:' ',beginUs:1000000,endUs:2000000}]}]}];
 const saved=JSON.stringify(d); const pure=serializeLyricTtml(d);const xml=new DOMParser().parseFromString(pure,'application/xml');
 const text=xml.getElementsByTagNameNS('http://music.apple.com/lyric-ttml-internal','text')[0];
 expect(text.children).toHaveLength(2); expect(text.textContent).toBe('a   ');expect(pure).not.toContain('studio:');expect(JSON.stringify(d)).toBe(saved);
 const content=d.romanizationTracks[0].contents[0];if(content.kind!=='timed')throw new Error('fixture');
 content.units[1].endUs=1000000; expect(()=>serializeLyricTtml(d)).toThrow('needs timing');
 content.units[1].endUs=null; content.units[1].text='word';expect(()=>serializeLyricTtml(d)).toThrow('needs timing');
});
