import { expect, it } from 'vitest';
import { createLyricDocument } from '../src/domain/lyric-document';
import { exportLyricFile, importLyricFile } from '../src/adapters/lyric-formats';

it('imports plain text as separate untimed lines', () => {
  const result = importLyricFile('first\nsecond\n', 'txt');
  expect(result.lines.map((line) => line.words[0].text)).toEqual(['first', 'second']);
  expect(result.lines[0].beginUs).toBeNull();
});

it.each(['lrc', 'eslrc', 'qrc', 'yrc', 'lys'] as const)('exports and imports %s timings', (format) => {
  const document = createLyricDocument('歌');
  const line = document.lines[0]; line.beginUs = 1_000_000; line.endUs = 2_000_000;
  line.words[0].beginUs = 1_000_000; line.words[0].endUs = 2_000_000;
  const content = exportLyricFile(document, format);
  const parsed = importLyricFile(content, format);
  expect(parsed.lines[0].words[0].text).toContain('歌');
  expect(parsed.lines[0].beginUs).toBe(1_000_000);
});

it('exports ASS and rejects an untimed final file', () => {
  const document = createLyricDocument('歌');
  expect(() => exportLyricFile(document, 'ass')).toThrow(/补全每行时间/);
  document.lines[0].beginUs = 1_000_000; document.lines[0].endUs = 2_000_000;
  expect(exportLyricFile(document, 'ass')).toContain('[Events]');
});
