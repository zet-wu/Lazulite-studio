import type { Page } from '@playwright/test';
import { importLyrics } from './import-lyrics';
export async function importPhase12(page: Page, count = 1) {
  const xml = await page.evaluate(async count => {
    const path = '/src/domain/lyric-document.ts', codecPath = '/src/adapters/ttml/lyric-codec.ts';
    const { createLyricDocument, createLine, createWord } = await import(path), codec = await import(codecPath);
    const doc = createLyricDocument('');
    doc.lines = Array.from({ length: count }, (_, index) => {
      const line = createLine('', `p12-${index}`);
      Object.assign(line, { beginMs: 1000, endMs: 5000 });
      line.words = ['今', '日', 'は', '歌'].map((text, i) => ({ ...createWord(text, `w${index}-${i}`), beginMs: 1000 + i * 1000, endMs: 2000 + i * 1000,
        rubyUnits: i < 2 ? [{ id: `r${index}-${i}`, reading: i ? 'う' : 'きょ', beginMs: 1000 + i * 1000, endMs: 1800 + i * 1000 }] : [] }));
      return line;
    });
    doc.lines.splice(1, 0, { ...createLine('', 'bg'), backgroundOf: 'p12-0', beginMs: 500, endMs: 5500, words: [createWord('背'), createWord('景')] });
    doc.translationTracks = [{ id: 't', language: 'en', purpose: 'subtitle', contents: [{ id: 'tc', lineId: 'p12-0', kind: 'plain', text: ' today ' }] }];
    doc.romanizationTracks = [{ id: 'r', language: 'ja-Latn', contents: [{ id: 'rc', lineId: 'p12-0', kind: 'timed', units: [{ id: 'ru', text: ' kyou ', beginMs: 1000, endMs: 3000 }] }] }];
    return codec.serializeLyricTtml(doc, { draft: true });
  }, count);
  await importLyrics(page, { name: 'phase12.ttml', mimeType: 'application/xml', buffer: Buffer.from(xml) });
  return xml;
}
