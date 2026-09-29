import { expect, it } from 'vitest';
import { createLyricDocument, createLine } from '../src/domain/lyric-document';
import { createLyricEditorState, executeLyricCommand, undoLyricCommand, redoLyricCommand } from '../src/domain/lyric-commands';
import { parseLyricTtml, serializeLyricTtml } from '../src/adapters/ttml/lyric-codec';
import { validateLanguageTag } from '../src/domain/sublyrics';

it('removes blank translations at command/import/export boundaries and restores deletions with history', () => {
  const document = createLyricDocument('前行'); document.lines.push(createLine('翻译行')); const line = document.lines[1];
  const items = [{ text: 'translation', language: 'en' }, { text: '译文', language: 'zh-Hans' }];
  let state = executeLyricCommand(createLyricEditorState(document), { type: 'set-sublyrics', lineId: line.id, kind: 'translations', items });
  const both = state.present;
  expect(executeLyricCommand(state, { type: 'set-sublyrics', lineId: document.lines[0].id, kind: 'translations', items: [{ text: '', language: 'en' }] })).toBe(state);
  state = executeLyricCommand(state, { type: 'set-sublyrics', lineId: line.id, kind: 'translations', items: [{ ...items[0], text: '  ' }, items[1]] });
  expect(state.present.lines[1].translations).toEqual([items[1]]);
  expect(undoLyricCommand(state).present).toBe(both);
  expect(redoLyricCommand(undoLyricCommand(state)).present).toBe(state.present);
  state = executeLyricCommand(state, { type: 'set-sublyrics', lineId: line.id, kind: 'translations', items: [] });
  const background = executeLyricCommand(state, { type: 'set-background-of', lineId: line.id, parentLineId: document.lines[0].id });
  expect(background.present.lines[1].backgroundOf).toBe(document.lines[0].id);
  const blank = createLyricDocument('行'); blank.lines[0].translations = [{ language: null, text: '' }];
  expect(serializeLyricTtml(blank)).not.toContain('x-translation');
  const xml = '<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata"><body><p>行<span ttm:role="x-translation"> </span></p></body></tt>';
  expect(parseLyricTtml(xml).lines[0].translations).toEqual([]);
  state.present.lines[1].endLink = { targetLineId: document.lines[0].id, originalEndUs: null };
  expect(() => executeLyricCommand(state, { type: 'set-background-of', lineId: line.id, parentLineId: document.lines[0].id })).toThrow(/行尾链接/);
});

it('preserves language and singer order through draft/final TTML and rejects invalid language drafts', () => {
  const document = createLyricDocument('歌');
  document.agents = ['v1', 'v2'].map(id => ({ id, name: null, type: 'person' as const }));
  document.lines[0].agentRefs = ['v2', 'v1'];
  document.lines.push(createLine('other'));
  document.lines[0].translations = [{ language: 'zh-Hans', text: '译文' }, { language: 'en', text: 'song' }, { language: null, text: '歌' }];
  for (const draft of [true, false]) {
    const reopened = parseLyricTtml(serializeLyricTtml(document, { draft }));
    expect(reopened.lines[0].translations).toEqual(document.lines[0].translations);
    expect(reopened.lines[0].agentRefs).toEqual(['v2', 'v1']);
  }
  for (const tag of ['zh-Hans', 'en-US', 'ja', 'x-song']) expect(() => validateLanguageTag(tag)).not.toThrow();
  for (const tag of ['en_US', 'a', 'en-', '中文']) expect(() => validateLanguageTag(tag)).toThrow(/语言标签/);
});
