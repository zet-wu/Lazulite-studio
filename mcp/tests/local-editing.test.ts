import { expect, it } from 'vitest';
import { createProjectDocument } from '../../frontend/src/domain/project-document';
import { createLine, createWord } from '../../frontend/src/domain/lyric-document';
import { createToolRegistry } from '../src/mcp-server';
import { formatToolError } from '../src/tools/registry';
import { projectFixture } from './project-fixture';
function fixture() {
  const doc = createProjectDocument();
  doc.lyrics.lines = [{ ...createLine('', 'l'), beginMs: 100, endMs: 700, words: [{ ...createWord('あ', 'w1'), beginMs: 100, endMs: 300 }, { ...createWord('い', 'w2'), beginMs: 500, endMs: 700 }] }];
  doc.lyrics.translationTracks = [{ id: 't', language: 'zh', purpose: 'subtitle', contents: [{ id: 'c', lineId: 'l', kind: 'plain', text: '你好' }] }];
  return projectFixture(doc);
}
it('splits and merges lines retaining identities, sublyrics, timing and client refs', async () => {
  const f = fixture(), registry = createToolRegistry();
  const result = await registry.call('edit_lyrics', { project_id: 'p', expected_revision: 'r1', operations: [{ op: 'split_line', line_id: 'l', before_word_id: 'w2', client_ref: 'second', translation_targets: { c: 1 } }, { op: 'insert_word', line_id: 'second', after_word_id: 'w2', text: 'う', client_ref: 'inserted' }, { op: 'edit_word', line_id: 'second', word_id: 'inserted', text: 'え' }] }, f) as { created_refs: Record<string,string> };
  expect(f.writes()).toBe(1);
  expect(f.doc().lyrics.lines.map(line => [line.beginMs, line.endMs, line.words.map(word => word.text)])).toEqual([[100,300,['あ']],[500,700,['い','え']]]);
  expect(f.doc().lyrics.translationTracks[0].contents[0].lineId).toBe(result.created_refs.second);
  await registry.call('edit_lyrics', { project_id: 'p', operations: [{ op: 'merge_lines', line_ids: ['l', result.created_refs.second] }] }, f);
  expect(f.doc().lyrics.translationTracks[0].contents[0]).toMatchObject({ id: 'c', lineId: 'l' });
});
it('edits partial timing and recomputes envelopes, clears endpoints, and rejects invalid batches', async () => {
  const f = fixture(), registry = createToolRegistry();
  await registry.call('edit_timing', { project_id: 'p', operations: [{ op: 'set_word_time', line_id: 'l', word_id: 'w2', end_ms: 900 }] }, f);
  expect(f.doc().lyrics.lines[0]).toMatchObject({ beginMs: 100, endMs: 900 });
  await registry.call('edit_timing', { project_id: 'p', operations: [{ op: 'set_word_time', line_id: 'l', word_id: 'w1', begin_ms: null }] }, f);
  expect(f.doc().lyrics.lines[0].words[0]).toMatchObject({ beginMs: null, endMs: 300 });
  const before = f.revision();
  try { await registry.call('edit_timing', { project_id: 'p', operations: [{ op: 'set_word_time', line_id: 'l', word_id: 'w2', end_ms: 800 }, { op: 'set_word_time', line_id: 'l', word_id: 'w1', end_ms: 50, begin_ms: 100 }] }, f); expect.unreachable(); }
  catch (error) { expect(formatToolError(error)).toMatchObject({ code: 'domain_error', details: { operation_index: 1, word_id: 'w1' } }); }
  expect(f.revision()).toBe(before);
});
it.each(['translation', 'romanization'] as const)('manages %s tracks and timed units atomically with refs', async kind => {
  const f = fixture(), registry = createToolRegistry();
  const result = await registry.call('edit_sublyrics', { project_id: 'p', operations: [{ op: 'create_track', kind, language: 'ja-Latn', client_ref: 'track' }, { op: 'insert_content', kind, track_ref: 'track', line_id: 'l', content_kind: 'timed', units: [{ text: 'ai', begin_ms: 100, end_ms: 700, client_ref: 'unit' }], client_ref: 'content' }, { op: 'split_unit', kind, track_ref: 'track', content_id: 'content', unit_id: 'unit', at: 1, client_ref: 'right' }, { op: 'update_unit', kind, track_ref: 'track', content_id: 'content', unit_id: 'right', text: 'u', begin_ms: null }] }, f) as { created_refs: Record<string,string> };
  const read = await registry.call('get_sublyrics', { project_id: 'p', kind, track_ids: [result.created_refs.track] }, f) as { tracks: { contents: unknown[] }[] };
  expect(read.tracks[0].contents[0]).toMatchObject({ content_id: result.created_refs.content, kind: 'timed', text: 'au', units: [{ text: 'a', begin_ms: 100, end_ms: 400 }, { text: 'u', begin_ms: null, end_ms: 700 }] });
  await registry.call('edit_sublyrics', { project_id: 'p', operations: [{ op: 'update_content', kind, track_id: result.created_refs.track, content_id: result.created_refs.content, content_kind: 'plain', text: 'plain' }] }, f);
  expect(f.writes()).toBe(2);
});

it('keeps unset parent endpoints when ruby envelope recomputation is disabled', async () => {
  const doc = createProjectDocument(); doc.lyrics.lines = [{ ...createLine('', 'l'), words: [{ ...createWord('真','w'), rubyUnits: [{ id: 'r', reading: 'しん', beginMs: null, endMs: null }] }] }];
  const f = projectFixture(doc), registry = createToolRegistry();
  await registry.call('edit_timing', { project_id: 'p', recompute_envelopes: false, operations: [{ op: 'set_ruby_time', line_id: 'l', word_id: 'w', ruby_id: 'r', begin_ms: 10, end_ms: 20 }] }, f);
  expect(f.doc().lyrics.lines[0]).toMatchObject({ beginMs: null, endMs: null, words: [{ beginMs: null, endMs: null, rubyUnits: [{ beginMs: 10, endMs: 20 }] }] });
  await registry.call('edit_timing', { project_id: 'p', operations: [{ op: 'set_ruby_time', line_id: 'l', word_id: 'w', ruby_id: 'r', end_ms: 30 }] }, f);
  expect(f.doc().lyrics.lines[0]).toMatchObject({ beginMs: 10, endMs: 30, words: [{ beginMs: 10, endMs: 30 }] });
});
