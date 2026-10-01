import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { expect, it } from 'vitest';
import { createLine, createLyricDocument } from '../../domain/lyric-document';
import { createLyricEditorState, executeLyricCommand } from '../../domain/lyric-commands';
import { syncUnits } from '../../domain/sync-editing';
import type { TransportHandle } from '../MediaTransport';
import { SyncPanel } from './SyncPanel';

it('uses the selected target and stops the completed line without writing the next line', () => {
  const document = createLyricDocument('今日');
  document.lines.push(createLine('明日'));
  const units = syncUnits(document);
  let timeMs = 1000;
  let state = createLyricEditorState(document);
  const transport = { current: { getPositionMs: () => timeMs, getPlaybackRate: () => 1, isPlaying: () => false, seekMs() {}, play() {}, pause() {}, audition() {} } satisfies TransportHandle };
  function Harness() {
    const [cursor, setCursor] = useState(units[0]);
    const [doc, setDoc] = useState(document);
    return <SyncPanel document={doc} cursor={cursor} transport={transport} onCursor={setCursor}
      apply={command => { state = executeLyricCommand(state, command); setDoc(state.present); return true; }} />;
  }
  render(<Harness />);
  fireEvent.change(screen.getByRole('combobox', { name: '打轴模式' }), { target: { value: 'line' } });
  fireEvent.keyDown(window, { code: 'KeyS', repeat: true });
  fireEvent.keyDown(screen.getByRole('spinbutton', { name: /输入偏移/ }), { code: 'KeyS' });
  expect(state.past).toHaveLength(0);
  fireEvent.keyDown(window, { code: 'KeyS' });
  timeMs = 2000;
  fireEvent.keyDown(window, { code: 'KeyD' });
  expect(screen.getByText('本行已完成')).toBeVisible();
  expect(state.present.lines[1]).toEqual(document.lines[1]);
  fireEvent.keyDown(window, { code: 'KeyD' });
  expect(state.past).toHaveLength(2);
  fireEvent.click(screen.getByRole('button', { name: '下一行' }));
  expect(screen.getByText('L2 · 单元 1 / 1')).toBeVisible();
  fireEvent.keyDown(window, { code: 'KeyS' });
  expect(state.present.lines[1].words[0].beginMs).toBe(2000);
});
