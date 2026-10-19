import { expect, it } from 'vitest';
import { createLyricDocument } from '../src/domain/lyric-document';
import { createLyricEditorState, executeLyricCommand } from './helpers/project-history';
import { serializeLyricTtml, parseLyricTtml } from '../src/adapters/ttml/lyric-codec';

it('keeps multiple artists, custom metadata and document language through a draft', () => {
  let state = createLyricEditorState(createLyricDocument('歌'));
  state = executeLyricCommand(state, { type: 'set-metadata', key: 'artist', values: ['Singer A', 'Singer B'] });
  state = executeLyricCommand(state, { type: 'set-metadata', key: 'customKey', values: ['value'] });
  state = executeLyricCommand(state, { type: 'set-language', language: 'ja' });
  const parsed = parseLyricTtml(serializeLyricTtml(state.present, { draft: true }));
  expect(parsed.metadata.artist).toEqual(['Singer A', 'Singer B']);
  expect(parsed.metadata.customKey).toEqual(['value']);
  expect(parsed.language).toBe('ja');
});
