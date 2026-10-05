import { expect, it } from 'vitest';
import { kanaHighlightHint, normalizeKanaHighlight, readKanaHighlight, saveKanaHighlight } from './kana-highlight';
it('normalizes a kana set, rejects nonkana and preserves a deliberately empty preference', () => {
  localStorage.clear(); expect(readKanaHighlight()).toBe('はへを');
  expect(normalizeKanaHighlight('ハ、は ヘを')).toBe('はへを');
  expect(() => normalizeKanaHighlight('漢字')).toThrow();
  expect(kanaHighlightHint('はな', 'は')).toContain('は');
  saveKanaHighlight(''); expect(readKanaHighlight()).toBe(''); localStorage.clear();
});
