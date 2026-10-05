import { expect, it } from 'vitest';
import { createLyricDocument, createLine, plainTranslation } from '../src/domain/lyric-document';
import { createLyricEditorState, executeLyricCommand, undoLyricCommand, redoLyricCommand } from '../src/domain/lyric-commands';
import { parseLyricTtml, serializeLyricTtml } from '../src/adapters/ttml/lyric-codec';
import { validateLanguageTag } from '../src/domain/sublyrics';
import { transferTranslations } from '../src/domain/translation-editing';

it('moves selected identities atomically, keeps existing destination content and rejects stale sources', () => {
  const document = createLyricDocument('前行'); document.lines.push(createLine('后行'));
  const one = plainTranslation('  one  ', document.lines[0].id), two = plainTranslation('two', document.lines[1].id), existing = plainTranslation('existing', document.lines[0].id);
  document.translationTracks = [{ id: 'a', language: 'en', purpose: 'subtitle', contents: [one, two] }, { id: 'b', language: 'ja', purpose: 'replacement', contents: [existing] }];
  const tracks = transferTranslations(document, [one.id], 'b');
  expect(tracks[0].contents).toEqual([two]); expect(tracks[1].contents).toEqual([existing, one]);
  const state = executeLyricCommand(createLyricEditorState(document), { type: 'set-translation-tracks', source: document.translationTracks, tracks });
  expect(undoLyricCommand(state).present).toBe(document); expect(redoLyricCommand(undoLyricCommand(state)).present).toBe(state.present);
  expect(() => executeLyricCommand(state, { type: 'set-translation-tracks', source: document.translationTracks, tracks })).toThrow('已变化');
  expect(executeLyricCommand(state, { type: 'set-translation-tracks', source: tracks, tracks })).toBe(state);
  expect(() => transferTranslations(document, ['missing'], 'b')).toThrow('失效');
});
it('preserves empty tracks, same-language tracks, same-line contents and raw whitespace in drafts and final grouping', () => {
  const document = createLyricDocument('歌'), lineId = document.lines[0].id;
  document.translationTracks = [{ id: 'a', language: 'en', purpose: 'subtitle', contents: [plainTranslation(' ', lineId), plainTranslation('one', lineId)] }, { id: 'b', language: 'en', purpose: 'replacement', contents: [plainTranslation('two', lineId)] }, { id: 'empty', language: null, purpose: 'subtitle', contents: [] }];
  expect(parseLyricTtml(serializeLyricTtml(document, { draft: true }))).toEqual(document);
  const xml = serializeLyricTtml(document); expect(xml).not.toContain('studio:');
  const reopened = parseLyricTtml(xml);
  expect(reopened.translationTracks.map(track => [track.language, track.purpose, track.contents.map(content => content.kind === 'plain' ? content.text : '')])).toEqual([['en', 'subtitle', [' ', 'one']], ['en', 'replacement', ['two']], [null, 'subtitle', []]]);
  for (const tag of ['zh-Hans', 'en-US', 'ja', 'x-song']) expect(() => validateLanguageTag(tag)).not.toThrow();
  for (const tag of ['en_MS', 'a', 'en-', '中文']) expect(() => validateLanguageTag(tag)).toThrow(/语言标签/);
});
