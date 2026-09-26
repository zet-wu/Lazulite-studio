import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { createLyricDocument } from '../../domain/lyric-document';
import { createLyricEditorState, executeLyricCommand } from '../../domain/lyric-commands';
import type { TransportHandle } from '../MediaTransport';
import { SyncPanel } from './SyncPanel';

it('stamps Ruby with configured keys while ignoring repeated and text-input keys', () => {
  localStorage.removeItem('lazulite-sync-keys');
  const document = createLyricDocument('今日');
  document.lines[0].words[0].rubyUnits = [
    { id: 'r1', reading: 'きょ', beginUs: null, endUs: null },
    { id: 'r2', reading: 'う', beginUs: null, endUs: null },
  ];
  let timeUs = 1_000_000;
  let state = createLyricEditorState(document);
  const transport = { current: { getPositionUs: () => timeUs, seekUs: () => {}, play: () => {}, pause: () => {}, audition: () => {} } satisfies TransportHandle };
  render(<SyncPanel document={document} currentLineId={document.lines[0].id} transport={transport} onCursor={() => {}}
    apply={(command) => { state = executeLyricCommand(state, command); return true; }} />);
  fireEvent.keyDown(window, { code: 'KeyS', key: 's', repeat: true });
  expect(state.past).toHaveLength(0);
  fireEvent.keyDown(screen.getByRole('spinbutton', { name: /输入偏移/ }), { code: 'KeyS', key: 's' });
  expect(state.past).toHaveLength(0);
  fireEvent.keyDown(window, { code: 'KeyS', key: 's' });
  expect(state.present.lines[0].words[0].rubyUnits[0].beginUs).toBe(1_000_000);
  timeUs = 1_500_000;
  fireEvent.keyDown(window, { code: 'KeyD', key: 'd' });
  expect(state.present.lines[0].words[0].rubyUnits.map((unit) => [unit.beginUs, unit.endUs])).toEqual([[1_000_000, 1_500_000], [1_500_000, null]]);
  expect(screen.getByText(/今日 → う/)).toBeVisible();
  fireEvent.keyDown(screen.getByRole('textbox', { name: '起始轴快捷键' }), { code: 'KeyD', key: 'd' });
  expect(screen.getByRole('alert')).toHaveTextContent('已分配');
  expect(state.past).toHaveLength(2);
});
