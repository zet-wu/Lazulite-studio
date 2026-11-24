import { expect, it } from 'vitest';
import { createLyricDocument } from '../src/domain/lyric-document';
import { timeEnvelope } from '../src/domain/lyric-commands';
import { resizeTimelineBoundary } from '../src/domain/timeline-editing';
import { collectOutputIssues } from '../src/adapters/output-validation';
import { parseLyricTtml, serializeLyricTtml } from '../src/adapters/ttml/lyric-codec';
import { projectTimeline } from '../src/domain/timeline-projection';
import { createLyricEditorState, executeLyricCommand, undoLyricCommand, redoLyricCommand } from './helpers/project-history';

it('drags through the opposite endpoint and keeps reversed endpoints through TTML and history', () => {
  const doc = createLyricDocument('歌'), line = doc.lines[0], word = line.words[0];
  Object.assign(line, { beginMs: 0, endMs: 4000 }); Object.assign(word, { beginMs: 1000, endMs: 2000 });
  const next = resizeTimelineBoundary(doc, { kind: 'word', lineId: line.id, wordId: word.id }, 'beginMs', 3000, false);
  expect(projectTimeline(next).lines[0].words[0]).toMatchObject({ beginMs: 3000, endMs: 2000 });
  expect(parseLyricTtml(serializeLyricTtml(next)).lines[0].words[0]).toMatchObject({ beginMs: 3000, endMs: 2000 });
  expect(collectOutputIssues(next, 'ttml')).toEqual([]);
  for (const format of ['elrc', 'ass', 'sug', 'krc', 'yrc', 'qrc'] as const) expect(collectOutputIssues(next, format).length).toBeGreaterThan(0);
  line.beginMs = 3000; line.endMs = 2000;
  expect(collectOutputIssues(doc, 'lrc').length).toBeGreaterThan(0);
  const state = executeLyricCommand(createLyricEditorState(doc), { type: 'replace-document', document: next });
  expect(undoLyricCommand(state).present).toBe(doc);
  expect(redoLyricCommand(undoLyricCommand(state)).present).toBe(next);
});
it('forms parent envelopes from every known endpoint', () => {
  expect(timeEnvelope([{ beginMs: 3000, endMs: 1000 }, { beginMs: null, endMs: 500 }])).toEqual({ beginMs: 500, endMs: 3000 });
  expect(timeEnvelope([{ beginMs: null, endMs: 500 }])).toEqual({ beginMs: 500, endMs: 500 });
  expect(timeEnvelope([])).toEqual({ beginMs: null, endMs: null });
});
