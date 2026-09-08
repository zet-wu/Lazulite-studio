import { describe, expect, it } from 'vitest';
import { importTtml, parseTime, serializeOriginal, serializeWithXmlSerializer } from '../src/adapters/ttml';
import golden from './fixtures/ttml-golden.xml?raw';

describe('Studio TTML profile probe', () => {
  it('parses media clock, milliseconds, nested relative timing and agents by namespace', () => {
    const document = importTtml(golden);
    expect(parseTime('00:00:01.250')).toBe(1_250_000);
    expect(document.lines[0]).toMatchObject({ text: ' A 𝄞 é 今日\n ', beginUs: 1_750_000, endUs: 5_500_000, agent: 'a1' });
    expect(document.lines[1]).toMatchObject({ beginUs: 3_500_000, endUs: 4_500_000, agent: 'a2' });
  });

  it('excludes metadata and ruby reading from line text while preserving code-point ranges', () => {
    const line = importTtml(golden).lines[0];
    expect(line.text).not.toContain('きょう');
    expect(line.ruby).toEqual([{ base: '今日', reading: 'きょう', baseStart: 8, baseEnd: 10 }]);
    expect(line.text).toContain('\n');

    const rubyProbe = importTtml('<tt xmlns="http://www.w3.org/ns/ttml" xmlns:tts="http://www.w3.org/ns/ttml#styling" xmlns:ext="urn:ext"><body><p>A<span tts:ruby="textContainer"><span tts:ruby="text">pollution</span></span></p><p><span tts:ruby="container"><span tts:ruby="base">B</span><span tts:ruby="text">bee</span><ext:noise>leak</ext:noise></span></p></body></tt>');
    expect(rubyProbe.lines.map((item) => item.text)).toEqual(['A', '']);
    expect(rubyProbe.lines.every((item) => item.ruby.length === 0)).toBe(true);
    expect(rubyProbe.issues.filter((issue) => issue.code === 'unsupported-ruby')).toHaveLength(2);
  });

  it('retains namespace URI, attribute order, whitespace and unknown nodes in the preservation tree', () => {
    const document = importTtml(golden);
    if (document.root.type !== 'element') throw new Error('TTML root must be an element');
    expect(document.root.namespaceURI).toBe('http://www.w3.org/ns/ttml');
    expect(document.root.attributes.some((item) => item.namespaceURI === 'http://www.w3.org/2000/xmlns/' && item.localName === 'ext')).toBe(true);
    expect(JSON.stringify(document.root)).toContain('extension text');
    expect(JSON.stringify(importTtml(serializeWithXmlSerializer(golden)).root)).toBe(JSON.stringify(document.root));
  });

  it('marks frame, tick and sequential timing as read-only with explicit reasons', () => {
    const document = importTtml(golden);
    expect(document.canEdit).toBe(false);
    expect(document.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(['unsupported-time', 'unsupported-seq']));
    expect(document.lines.slice(2).every((line) => line.beginUs === null && line.endUs === null)).toBe(true);
    expect(parseTime('00:60:00')).toBeNull();
    expect(parseTime('4.1s')).toBe(4_100_000);
  });

  it('returns the untouched source exactly, including declaration and formatting', () => {
    expect(serializeOriginal(importTtml(golden))).toBe(golden);
  });

  it('reports unknown content, non-media and sequential timing while rejecting invalid inputs', () => {
    const probe = `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttp="http://www.w3.org/ns/ttml#parameter" xmlns:ext="urn:ext"><head><metadata>hidden</metadata></head><body><div timeContainer="seq"><p>hidden by seq</p></div><div ttp:timeBase="smpte"><p>hidden by clock</p></div><p>visible<ext:unknown>leak</ext:unknown></p></body></tt>`;
    const document = importTtml(probe);
    expect(document.lines.map((line) => line.text)).toEqual(['hidden by seq', 'hidden by clock', 'visible']);
    expect(document.lines.slice(0, 2).every((line) => line.beginUs === null && line.endUs === null)).toBe(true);
    expect(document.lines[2].text).toBe('visible');
    expect(document.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(['unsupported-seq', 'unsupported-time-base', 'unknown-namespace']));
    expect(() => importTtml('<!DOCTYPE tt [<!ENTITY x "bad">]><tt/>')).toThrow(/DTD/);
    expect(() => importTtml('<root xmlns="urn:other"/>')).toThrow(/Root/);
  });
});
