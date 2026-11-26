import { expect, it } from 'vitest';
import { createProjectDocument } from '../../frontend/src/domain/project-document';
import { createLine, createWord } from '../../frontend/src/domain/lyric-document';
import { DEFAULT_SEGMENT_OPTIONS, segmentText } from '../../frontend/src/domain/segmentation';
import { proposeRomanization, romanizationGenerationCommand } from '../../frontend/src/domain/romanization-generation';
import { rubySourceRows, proposeRuby, rubyGenerationCommand } from '../../frontend/src/domain/ruby-generation';
import { shiftLineTimes } from '../../frontend/src/domain/batch-editing';
import { createToolRegistry } from '../src/mcp-server';
import { run } from '../src/tools/editing';
import { projectFixture } from './project-fixture';
function fixture(text = 'しゃっティ') {
  const doc = createProjectDocument(); doc.lyrics.lines = [{ ...createLine('', 'l'), beginMs: 100, endMs: 900, words: [{ ...createWord(text, 'w'), beginMs: 100, endMs: 900 }] }]; return doc;
}
it('shares UI mora/syllable segmentation and dry_run never changes the revision', async () => {
  const f = projectFixture(fixture()), registry = createToolRegistry();
  const args = { project_id: 'p', target: 'words', scope: { all: true }, options: { japanese_mora: true } };
  const preview = await registry.call('segment_lyrics', args, f) as { changed_count: number; preview: { after: string[] }[] };
  expect(preview.preview[0].after).toEqual(segmentText('しゃっティ', { ...DEFAULT_SEGMENT_OPTIONS, japaneseMora: true }));
  expect(f.revision()).toBe('r1'); expect(f.writes()).toBe(0);
  await registry.call('segment_lyrics', { ...args, dry_run: false }, f);
  expect(f.doc().lyrics.lines[0].words.map(w => w.text)).toEqual(preview.preview[0].after); expect(f.writes()).toBe(1);
  const syllable = projectFixture(fixture('beautiful'));
  const result = await registry.call('segment_lyrics', { ...args, options: { western: 'syllable', language: 'en-us' } }, syllable) as { changed_count: number };
  expect(result.changed_count).toBe(1);
});
it('blocks word ruby overwrite and splits ruby mora with time and beats preserved', async () => {
  const doc = fixture('真'); doc.lyrics.lines[0].words[0].rubyUnits = [{ id: 'r', reading: 'しん', beginMs: 100, endMs: 900 }]; doc.editing.emptyBeats = { r: { kind: 'ruby', count: 2 } };
  const f = projectFixture(doc), registry = createToolRegistry();
  await registry.call('segment_lyrics', { project_id: 'p', target: 'ruby', scope: { all: true } }, f); expect(f.writes()).toBe(0);
  await registry.call('segment_lyrics', { project_id: 'p', dry_run: false, target: 'ruby', scope: { all: true } }, f);
  expect(f.doc().lyrics.lines[0].words[0].rubyUnits.map(u => [u.reading,u.beginMs,u.endMs])).toEqual([['し',100,500],['ん',500,900]]);
  expect(f.doc().editing.emptyBeats.r).toEqual({ kind: 'ruby', count: 2 });
  const blocked = projectFixture(fixture()); const bdoc = blocked.doc(); bdoc.lyrics.lines[0].words[0].rubyUnits = [{ id: 'r', reading: 'しゃっティ', beginMs: 100, endMs: 900 }]; const bf = projectFixture(bdoc);
  expect(await registry.call('segment_lyrics', { project_id: 'p', target: 'words', scope: { all: true }, options: { japanese_mora: true }, skip_existing_ruby:false }, bf)).toMatchObject({ blocked_count: 1 });
});
it('normalizes particles and applies identical romanization commands while preserving null timing', async () => {
  const doc = fixture('は'); doc.lyrics.lines[0].words[0].beginMs = null; doc.lyrics.lines[0].words[0].endMs = null; let particleCalls = 0;
  const particles = [{ line_id: 'l', start: 0, end: 1, reading: 'わ' }];
  const f = projectFixture(doc, url => { expect(url.pathname).toBe('/api/v1/reading/particles'); particleCalls++; return Response.json({ ranges: particles }); });
  const registry = createToolRegistry(), args = { project_id: 'p', kind: 'timed' };
  const p = await registry.call('generate_romanization', args, f) as { proposals: unknown[] };
  expect(p.proposals).toEqual(proposeRomanization(f.doc().lyrics, ['l'], 'timed', particles)); expect(f.writes()).toBe(0);
  await registry.call('generate_romanization', { ...args, dry_run: false }, f);
  expect(f.doc().lyrics.romanizationTracks[0].contents[0]).toMatchObject({ kind: 'timed', units: [{ text: 'wa', beginMs: null, endMs: null }] }); expect(particleCalls).toBe(2);
  const skipped = await registry.call('generate_romanization', { ...args, dry_run: false, target_track_id: f.doc().lyrics.romanizationTracks[0].id }, f);
  expect(skipped).toMatchObject({ changed_count: 0 }); expect(f.writes()).toBe(1);
});
it('uses shared reverse generation with preview issues and explicit candidate assignments', async () => {
  const doc = fixture('真'); doc.lyrics.romanizationTracks = [{ id: 't', language: 'ja-Latn', contents: [{ id: 'c', kind: 'timed', lineId: 'l', units: [{ id: 'u', text: 'shin', beginMs: 100, endMs: 900 }] }] }];
  const f = projectFixture(doc), registry = createToolRegistry(), args = { project_id: 'p', track_id: 't' };
  const source = f.doc(), rows = proposeRuby(rubySourceRows(source.lyrics, 't', ['c']), 'hiragana');
  const expected = run(source, rubyGenerationCommand(source.lyrics, source.lyrics, rows, {}, new Set(), new Set(), source.editing));
  expect(await registry.call('generate_ruby_from_romanization', args, f)).toMatchObject({ changed_count: 1, issues: [] }); expect(f.writes()).toBe(0);
  await registry.call('generate_ruby_from_romanization', { ...args, dry_run: false }, f);
  expect(f.doc().lyrics.lines[0].words[0].rubyUnits.map(({ id: _, ...u }) => u)).toEqual(expected.lyrics.lines[0].words[0].rubyUnits.map(({ id: _, ...u }) => u));
});
it('matches batch domain commands and rejects stale apply revisions without writing', async () => {
  const f = projectFixture(fixture('あ')), registry = createToolRegistry(), args = { project_id: 'p', scope: { all: true }, action: { type: 'shift', delta_ms: 200 } };
  const source = f.doc(), expected = run(source, shiftLineTimes(source.lyrics, ['l'], 200, source.editing));
  await registry.call('batch_edit_lyrics', args, f); expect(f.writes()).toBe(0);
  await expect(registry.call('batch_edit_lyrics', { ...args, dry_run: false, expected_revision: 'stale' }, f)).rejects.toMatchObject({ status: 412 }); expect(f.writes()).toBe(0);
  await registry.call('batch_edit_lyrics', { ...args, dry_run: false }, f); expect(f.doc()).toEqual(expected); expect(f.writes()).toBe(1);
});

it.each(['translation', 'romanization'] as const)('reports a shift affecting only timed %s contents in both preview and apply', async kind => {
  const doc = createProjectDocument();
  doc.lyrics.lines = [createLine('untimed', 'l'), createLine('unchanged', 'other')];
  const contents = [{ id: 'c', lineId: 'l', kind: 'timed' as const, units: [{ id: 'u', text: 'timed', beginMs: 100, endMs: 900 }] }];
  if (kind === 'translation') doc.lyrics.translationTracks = [{ id: 't', language: 'zh', purpose: 'subtitle', contents }];
  else doc.lyrics.romanizationTracks = [{ id: 't', language: 'ja-Latn', contents }];
  const f = projectFixture(doc), registry = createToolRegistry();
  const args = { project_id: 'p', scope: { all: true }, action: { type: 'shift', delta_ms: 200 } };
  const expected = { changed_count: 1, affected_lines: ['l'], invalidates_alignment: true };
  expect(await registry.call('batch_edit_lyrics', args, f)).toMatchObject({ ...expected, changed: false, dry_run: true });
  expect(f.writes()).toBe(0); expect(f.revision()).toBe('r1');
  expect(await registry.call('batch_edit_lyrics', { ...args, dry_run: false }, f)).toMatchObject({ ...expected, changed: true, dry_run: false, previous_revision: 'r1', new_revision: 'r2' });
  expect(f.writes()).toBe(1);
  const saved = f.doc(), tracks = kind === 'translation' ? saved.lyrics.translationTracks : saved.lyrics.romanizationTracks;
  expect(tracks[0].contents[0]).toMatchObject({ units: [{ beginMs: 300, endMs: 1100 }] });
  expect(saved.lyrics.lines).toEqual(doc.lyrics.lines);
  expect(await registry.call('batch_edit_lyrics', { ...args, dry_run: false, action: { type: 'shift', delta_ms: 0 } }, f)).toMatchObject({ changed: false, changed_count: 0, affected_lines: [], invalidates_alignment: false });
  expect(f.writes()).toBe(1);
});
