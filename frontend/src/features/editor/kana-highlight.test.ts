import { expect, it } from 'vitest';
import { kanaHighlightHint, normalizeKanaHighlight } from './kana-highlight';
it('normalizes a kana set, rejects nonkana', () => {
  expect(normalizeKanaHighlight('ハ、は ヘを')).toBe('はへを');
  expect(() => normalizeKanaHighlight('漢字')).toThrow();
  expect(kanaHighlightHint('はな', 'は')).toContain('は');
  expect(normalizeKanaHighlight('')).toBe('');
});
