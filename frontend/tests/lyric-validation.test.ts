import { createProjectEditing } from '../src/domain/project-editing';
import { expect, it } from 'vitest';
import { createLyricDocument, createWord } from '../src/domain/lyric-document';
import { validateLyrics, validateLyricsIncrementally } from '../src/adapters/lyric-validation';
import { exportLyricFile } from '../src/adapters/lyric-formats';
it('checks actual output gates and merges affected formats without blocking TXT or TTML for zero punctuation', () => {
  const doc = createLyricDocument('a'); doc.lines[0].beginMs = 0; doc.lines[0].endMs = 200;
  doc.lines[0].words[0].beginMs = 0; doc.lines[0].words[0].endMs = 100;
  doc.lines[0].words.push({ ...createWord('！'), beginMs: 100, endMs: 100 });
  const issues = validateLyrics(doc);
  const zero = issues.find(issue => issue.code === 'punctuation-zero');
  expect(zero?.severity).toBe('warning');
  const error = issues.find(issue => issue.code === 'invalid-range');
  expect(error?.formats).toEqual(['ESLRC', 'QRC', 'YRC', 'LYS']);
  expect(issues.some(issue => issue.formats?.includes('KRC'))).toBe(false);
  expect(() => exportLyricFile(doc, 'ttml')).not.toThrow();
  doc.lines[0].words[1].endMs = null;
  expect(() => exportLyricFile(doc, 'txt')).not.toThrow();
  expect(validateLyrics(doc).some(issue => issue.code === 'missing-time')).toBe(true);
});
it('keeps rich valid lyrics out of the issue list and describes actual ASS output once', async () => {
  const { describeLyricFormat } = await import('../src/adapters/format-description');
  const doc = createLyricDocument('字'); const line = doc.lines[0]; line.beginMs = 0; line.endMs = 1000;
  line.words = Array.from({ length: 50 }, (_, i) => ({ ...createWord('字'), beginMs: i * 20, endMs: (i + 1) * 20, rubyUnits: [{ id: `r${i}`, reading: 'じ', beginMs: i * 20, endMs: (i + 1) * 20 }] }));
  doc.translationTracks = [{ id: 't', language: 'en', purpose: 'subtitle', contents: [{ id: 'c', lineId: line.id, kind: 'plain', text: 'translation' }] }];
  doc.romanizationTracks = [{ id: 'r', language: 'ja', contents: [{ id: 'rc', lineId: line.id, kind: 'plain', text: 'romanization' }] }];
  expect(validateLyrics(doc)).toEqual([]);
  expect(describeLyricFormat(doc, 'txt').filter(row => row.element === '注音' && row.status === 'omitted')).toHaveLength(1);
  const ass = exportLyricFile(doc, 'ass'); expect(ass).toContain('translation'); expect(ass).toContain('romanization');
  expect(describeLyricFormat(doc, 'ass').filter(row=>row.result==='分轨字幕')).toHaveLength(2);
  expect(describeLyricFormat(doc, 'ass')[0].detail).toContain('厘秒');
  line.words[0].beginMs = null;
  expect(validateLyrics(doc).some(issue => issue.code === 'missing-time' && issue.wordId === line.words[0].id && !issue.formats?.includes('TXT'))).toBe(true);
  expect(() => exportLyricFile(doc, 'txt')).not.toThrow();
});
it('describes background and timing projections without treating them as source problems', async () => {
  const { describeLyricFormat } = await import('../src/adapters/format-description');
  const { createLine } = await import('../src/domain/lyric-document');
  const doc = createLyricDocument('main'); doc.lines.push({ ...createLine('background'), backgroundOf: doc.lines[0].id });
  for (const line of doc.lines) { line.beginMs = 0; line.endMs = 1000; line.words[0].beginMs = 0; line.words[0].endMs = 1000; }
  expect(validateLyrics(doc)).toEqual([]);
  for (const format of ['txt', 'lrc', 'elrc'] as const) {
    expect(exportLyricFile(doc, format)).not.toContain('background');
    expect(describeLyricFormat(doc, format).find(row=>row.element==='背景')?.status).toBe('omitted');
  }
  for (const format of ['ass', 'eslrc', 'qrc', 'yrc', 'lys'] as const) expect(exportLyricFile(doc, format)).toContain('background');
  expect(exportLyricFile(doc, 'lrc')).toContain('[00:01.000]');
  expect(describeLyricFormat(doc, 'lrc')[0].detail).toContain('段尾');
});
it('merges the same missing translation endpoint across TTML and ASS',()=>{
 const doc=createLyricDocument('a');const line=doc.lines[0];line.beginMs=0;line.endMs=1000;line.words[0].beginMs=0;line.words[0].endMs=1000;
 doc.translationTracks=[{id:'t',language:'en',purpose:'subtitle',contents:[{id:'c',lineId:line.id,kind:'timed',units:[{id:'u',text:'word',beginMs:100,endMs:null}]}]}];
 const issues=validateLyrics(doc).filter(issue=>issue.unitId==='u');expect(issues).toHaveLength(1);expect(issues[0].formats).toEqual(['TTML','ASS']);
});

it('incremental execution yields with identical full results and aborts stale work',async()=>{
 const document=createLyricDocument('unfinished'),editing=createProjectEditing();
 expect(await validateLyricsIncrementally(document,editing,new AbortController().signal)).toEqual(validateLyrics(document,editing));
 const controller=new AbortController();const pending=validateLyricsIncrementally(document,editing,controller.signal);controller.abort();
 await expect(pending).rejects.toMatchObject({name:'AbortError'});
});

it('allows partial body and Ruby TTML endpoints while retaining sidecar blockers',()=>{
 const doc=createLyricDocument('字'),line=doc.lines[0],word=line.words[0];
 word.beginMs=200;word.rubyUnits=[{id:'ruby',reading:'じ',beginMs:null,endMs:2000}];
 const xml=exportLyricFile(doc,'ttml');
 expect(xml).not.toContain('studio:');expect(xml).toContain('begin="00:00.200"');expect(xml).toContain('end="00:02.000"');
 expect(validateLyrics(doc).filter(issue=>issue.formats?.includes('TTML'))).toEqual([]);
 expect(()=>exportLyricFile(doc,'lrc')).toThrow();
});
