import { expect, it } from 'vitest';
import { createProjectDocument } from '../../frontend/src/domain/project-document';
import { createLine, createWord } from '../../frontend/src/domain/lyric-document';
import { createToolRegistry } from '../src/mcp-server';
import { formatToolError } from '../src/tools/registry';
import { projectFixture } from './project-fixture';

it.each([true, false])('atomically reannotates ruby words with inherited timing=%s, beats, singers and end links', async timed => {
  const doc = createProjectDocument();
  const word = { ...createWord('待っ', 'w'), agentRefs: ['v'], rubyUnits: [{ id: 'old', reading: 'まっ', beginMs: timed ? 100 : null, endMs: timed ? 900 : null }] };
  doc.lyrics.agents = [{ id: 'v', type: 'person', name: null }]; doc.amll.noWordAgents = false;
  doc.lyrics.lines = [{ ...createLine('', 'l'), beginMs: timed ? 100 : null, endMs: timed ? 900 : null, words: [word] }, { ...createLine('', 'next'), beginMs: 900 }];
  if (timed) doc.editing.endLinks = { l: 'next' };
  doc.editing.emptyBeats = { old: { kind: 'ruby', count: 2 } };
  const fixture = projectFixture(doc), registry = createToolRegistry();
  const result = await registry.call('apply_readings', { project_id: 'p', expected_revision: 'r1', overwrite_existing: true, operations: [{ mode: 'split_and_set_word', line_id: 'l', word_id: 'w', parts: [{ text: '待', readings: ['ま'] }, { text: 'っ', readings: [] }] }] }, fixture) as { created_word_ids: string[] };
  expect(result.created_word_ids).toHaveLength(1); expect(fixture.writes()).toBe(1);
  const saved = fixture.doc(), words = saved.lyrics.lines[0].words;
  expect(words.map(word => word.text)).toEqual(['待', 'っ']);
  expect(words[0].rubyUnits[0]).toMatchObject({ reading: 'ま', beginMs: timed ? 100 : null, endMs: timed ? 500 : null });
  expect(words[1]).toMatchObject({ beginMs: timed ? 500 : null, endMs: timed ? 900 : null, agentRefs: ['v'] });
  expect(saved.editing.emptyBeats).toEqual({ [words[0].rubyUnits[0].id]: { kind: 'ruby', count: 2 } });
  expect(saved.editing.endLinks).toEqual(timed ? { l: 'next' } : {});
});
it('splits old ruby through line spans and reports exact failed operation without saving', async () => {
  const doc = createProjectDocument(); doc.lyrics.lines = [{ ...createLine('', 'l'), words: [{ ...createWord('真彷徨しゃっ', 'w'), rubyUnits: [{ id: 'r', reading: 'しんさまようしゃっ', beginMs: null, endMs: null }] }] }];
  const f = projectFixture(doc), registry = createToolRegistry();
  await registry.call('apply_readings', { project_id: 'p', overwrite_existing: true, operations: [{ mode: 'set_line_spans', line_id: 'l', spans: [{ base_start: 0, base_end: 1, readings: ['し', 'ん'] }, { base_start: 1, base_end: 3, readings: ['さ', 'ま', 'よ', 'う'] }] }] }, f);
  expect(f.doc().lyrics.lines[0].words.map(word => word.text)).toEqual(['真', '彷徨', 'しゃっ']);
  const revision = f.revision();
  try { await registry.call('apply_readings', { project_id: 'p', overwrite_existing: true, operations: [{ mode: 'set_word', line_id: 'l', word_id: 'w', readings: ['ま'] }, { mode: 'split_and_set_word', line_id: 'l', word_id: 'w', parts: [{ text: 'あ', readings: [] }, { text: 'い', readings: [] }] }] }, f); expect.unreachable(); }
  catch (error) { expect(formatToolError(error)).toMatchObject({ code: 'split_text_mismatch', details: { operation_index: 1, line_id: 'l', word_id: 'w', current_revision: revision } }); }
  expect(f.revision()).toBe(revision); expect(f.writes()).toBe(1);
});
