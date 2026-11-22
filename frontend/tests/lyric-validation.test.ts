import { expect, it } from 'vitest';
import { createLyricDocument, createLine, createWord } from '../src/domain/lyric-document';
import { exportLyricFile } from '../src/adapters/lyric-formats';
import { describeLyricFormat } from '../src/adapters/format-description';
import { collectOutputIssues } from '../src/adapters/output-validation';

it('describes actual ASS output and omitted elements without blocking TXT', () => {
  const doc = createLyricDocument('字');
  const line = doc.lines[0];
  line.beginMs = 0; line.endMs = 1000;
  line.words = Array.from({ length: 50 }, (_, i) => ({
    ...createWord('字'), beginMs: i * 20, endMs: (i + 1) * 20,
    rubyUnits: [{ id: `r${i}`, reading: 'じ', beginMs: i * 20, endMs: (i + 1) * 20 }],
  }));
  doc.translationTracks = [{ id: 't', language: 'en', purpose: 'subtitle', contents: [{ id: 'c', lineId: line.id, kind: 'plain', text: 'translation' }] }];
  doc.romanizationTracks = [{ id: 'r', language: 'ja', contents: [{ id: 'rc', lineId: line.id, kind: 'plain', text: 'romanization' }] }];
  expect(describeLyricFormat(doc, 'txt').filter(row => row.element === 'batch.reading' && row.status === 'omitted')).toHaveLength(1);
  const ass = exportLyricFile(doc, 'ass');
  expect(ass).toContain('translation');
  expect(ass).toContain('romanization');
  expect(describeLyricFormat(doc, 'ass').filter(row => row.result === 'format.trackEvents')).toHaveLength(2);
  expect(describeLyricFormat(doc, 'ass')[0].detail.parts?.[0].key).toBe('format.assDetail');
  line.words[0].beginMs = null;
  expect(() => exportLyricFile(doc, 'txt')).not.toThrow();
});

it('describes background and timing projections without treating them as source problems', () => {
  const doc = createLyricDocument('main');
  doc.lines.push({ ...createLine('background'), backgroundOf: doc.lines[0].id });
  for (const line of doc.lines) { line.beginMs = 0; line.endMs = 1000; line.words[0].beginMs = 0; line.words[0].endMs = 1000; }
  for (const format of ['txt', 'lrc', 'elrc'] as const) {
    expect(exportLyricFile(doc, format)).not.toContain('background');
    expect(describeLyricFormat(doc, format).find(row => row.element === 'editor.background')?.status).toBe('omitted');
  }
  for (const format of ['ass', 'eslrc', 'qrc', 'yrc', 'lys'] as const) expect(exportLyricFile(doc, format)).toContain('background');
  expect(exportLyricFile(doc, 'lrc')).toContain('[00:01.000]');
  expect(describeLyricFormat(doc, 'lrc')[0].detail.parts?.[0].key).toBe('format.lrcDetail');
});

it('allows partial body and Ruby TTML endpoints while retaining sidecar blockers', () => {
  const doc = createLyricDocument('字'), line = doc.lines[0], word = line.words[0];
  word.beginMs = 200;
  word.rubyUnits = [{ id: 'ruby', reading: 'じ', beginMs: null, endMs: 2000 }];
  const xml = exportLyricFile(doc, 'ttml');
  expect(xml).not.toContain('studio:');
  expect(xml).toContain('begin="00:00.200"');
  expect(xml).toContain('end="00:02.000"');
  expect(collectOutputIssues(doc, 'ttml')).toEqual([]);
  expect(() => exportLyricFile(doc, 'lrc')).toThrow();
});
