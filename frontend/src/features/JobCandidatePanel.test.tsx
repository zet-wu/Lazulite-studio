import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { parseLyricTtml } from '../adapters/ttml/lyric-codec';
import { createLyricEditorState, executeLyricCommand } from '../domain/lyric-commands';
import type { AlignResult, ForcedAlignResult, ReadingResult } from '../adapters/http/jobs';
import { JobCandidatePanel } from './JobCandidatePanel';

afterEach(cleanup);

it('applies aligned line timing as one command and blocks stale results', () => {
  const document = parseLyricTtml('<tt xmlns="http://www.w3.org/ns/ttml"><body><p xml:id="a">A</p></body></tt>');
  const result: AlignResult = { kind: 'line_align', binding: { revision: 'r1', asset_id: 'asset' }, lines: [{ line_id: 'a', begin_us: 0, end_us: 1_000_000 }] };
  let state = createLyricEditorState(document);
  const view = render(<JobCandidatePanel result={result} currentRevision="r1" currentAssetId="asset" dirty={false} document={document} onApply={(command) => { state = executeLyricCommand(state, command); }} />);
  fireEvent.click(screen.getByRole('button', { name: '人工应用候选' }));
  expect(state.present.lines[0]).toMatchObject({ beginUs: 0, endUs: 1_000_000 });
  expect(state.past).toHaveLength(1);
  view.rerender(<JobCandidatePanel result={result} currentRevision="r2" currentAssetId="asset" dirty={false} document={document} onApply={() => undefined} />);
  expect(screen.getByRole('button', { name: '人工应用候选' })).toBeDisabled();
});

it('maps a reading candidate to the matching semantic word', () => {
  const document = parseLyricTtml('<tt xmlns="http://www.w3.org/ns/ttml"><body><p xml:id="line"><span>今日</span><span>宇宙</span></p></body></tt>');
  const result: ReadingResult = { kind: 'reading', binding: { revision: 'r1', asset_id: 'asset' }, proposals: [{ line_id: 'line', proposal_id: 'p1', base_start: 0, base_end: 2, base: '今日', reading: 'きょう', source: 'dictionary', needs_review: true }] };
  let state = createLyricEditorState(document);
  render(<JobCandidatePanel result={result} currentRevision="r1" currentAssetId="asset" dirty={false} document={document} onApply={(command) => { state = executeLyricCommand(state, command); }} />);
  fireEvent.click(screen.getByRole('button', { name: '人工应用候选' }));
  expect(state.present.lines[0].words[0].rubyUnits[0].reading).toBe('きょう');
  expect(state.present.lines[0].words[1]).toBe(document.lines[0].words[1]);
});

it('maps forced Ruby timing to a Ruby unit without touching another word', () => {
  const document = parseLyricTtml('<tt xmlns="http://www.w3.org/ns/ttml" xmlns:tts="http://www.w3.org/ns/ttml#styling"><body><p xml:id="line"><span tts:ruby="container"><span tts:ruby="base">今日</span><span tts:ruby="textContainer"><span tts:ruby="text">きょう</span></span></span><span>宇宙</span></p></body></tt>');
  const word = document.lines[0].words[0];
  const ruby = word.rubyUnits[0];
  const result: ForcedAlignResult = { kind: 'forced_align', binding: { revision: 'r1', asset_id: 'asset' }, units: [{ line_id: 'line', input_range: [0, 3], source_range: [0, 2], text: 'きょう', start_us: 100_000, end_us: 500_000, granularity: 'word', confidence: 0.9, ruby_id: ruby.id }] };
  let state = createLyricEditorState(document);
  render(<JobCandidatePanel result={result} currentRevision="r1" currentAssetId="asset" dirty={false} document={document} onApply={(command) => { state = executeLyricCommand(state, command); }} />);
  fireEvent.click(screen.getByRole('button', { name: '人工应用候选' }));
  expect(state.present.lines[0].words[0].rubyUnits[0]).toMatchObject({ beginUs: 100_000, endUs: 500_000 });
  expect(state.present.lines[0].words[1]).toBe(document.lines[0].words[1]);
});

it('retains mora timing as attached draft data', () => {
  const document = parseLyricTtml('<tt xmlns="http://www.w3.org/ns/ttml"><body><p xml:id="line"><span>今日</span></p></body></tt>');
  const result: ForcedAlignResult = { kind: 'forced_align', job_id: 'job', binding: { revision: 'r1', asset_id: 'asset' }, units: [{ line_id: 'line', input_range: [0, 2], source_range: [0, 2], text: 'きょ', start_us: 100_000, end_us: 200_000, granularity: 'mora', confidence: 0.8 }] };
  let state = createLyricEditorState(document);
  render(<JobCandidatePanel result={result} currentRevision="r1" currentAssetId="asset" dirty={false} document={document} onApply={(command) => { state = executeLyricCommand(state, command); }} />);
  fireEvent.click(screen.getByRole('button', { name: '人工应用候选' }));
  expect(state.present.lines[0].words[0].alignmentUnits[0]).toMatchObject({ kind: 'mora', text: 'きょ', beginUs: 100_000, endUs: 200_000 });
});
