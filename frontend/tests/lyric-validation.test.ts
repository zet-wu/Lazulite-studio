import { expect, it } from 'vitest';
import { createLyricDocument, createWord } from '../src/domain/lyric-document';
import { validateLyrics } from '../src/adapters/lyric-validation';
import { exportLyricFile } from '../src/adapters/lyric-formats';
it('checks actual output gates and merges affected formats without blocking TXT or TTML for zero punctuation', () => {
  const doc = createLyricDocument('a'); doc.lines[0].beginMs = 0; doc.lines[0].endMs = 200;
  doc.lines[0].words[0].beginMs = 0; doc.lines[0].words[0].endMs = 100;
  doc.lines[0].words.push({ ...createWord('！'), beginMs: 100, endMs: 100 });
  const issues = validateLyrics(doc);
  const zero = issues.find(issue => issue.code === 'punctuation-zero');
  expect(zero?.severity).toBe('warning');
  const error = issues.find(issue => issue.code === 'invalid-range');
  expect(error?.formats).toEqual(['ESLRC', 'QRC', 'YRC', 'LYS', 'ASS']);
  expect(issues.some(issue => issue.formats?.includes('KRC'))).toBe(false);
  expect(() => exportLyricFile(doc, 'ttml')).not.toThrow();
  doc.lines[0].words[1].endMs = null;
  expect(() => exportLyricFile(doc, 'txt')).not.toThrow();
  expect(validateLyrics(doc).some(issue => issue.code === 'missing-time')).toBe(true);
});
