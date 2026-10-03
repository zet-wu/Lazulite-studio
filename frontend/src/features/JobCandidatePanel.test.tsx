import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { parseLyricTtml } from '../adapters/ttml/lyric-codec';
import { createLyricEditorState, executeLyricCommand } from '../domain/lyric-commands';
import type { AlignResult } from '../adapters/http/jobs';
import { JobCandidatePanel } from './JobCandidatePanel';

afterEach(cleanup);

it('applies aligned line timing as one command and blocks stale results', () => {
  const document = parseLyricTtml('<tt xmlns="http://www.w3.org/ns/ttml"><body><p xml:id="a">A</p></body></tt>');
  const result: AlignResult = { kind: 'line_align', binding: { revision: 'r1', asset_id: 'asset' }, lines: [{ line_id: 'a', begin_ms: 0, end_ms: 1000 }] };
  let state = createLyricEditorState(document);
  const view = render(<JobCandidatePanel result={result} currentRevision="r1" currentAssetId="asset" dirty={false} document={document} onApply={(command) => { state = executeLyricCommand(state, command); }} />);
  fireEvent.click(screen.getByRole('button', { name: '人工应用候选' }));
  expect(state.present.lines[0]).toMatchObject({ beginMs: 0, endMs: 1000 });
  expect(state.past).toHaveLength(1);
  view.rerender(<JobCandidatePanel result={result} currentRevision="r2" currentAssetId="asset" dirty={false} document={document} onApply={() => undefined} />);
  expect(screen.getByRole('button', { name: '人工应用候选' })).toBeDisabled();
});
