import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { createLyricDocument } from '../domain/lyric-document';
import { TimelineTracks } from './TimelineTracks';

it('uses half-open independent intervals across line, word and 注音 at seek and paused positions', () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  const document = createLyricDocument('合成');
  const line = document.lines[0], word = line.words[0];
  line.beginMs = 1000; line.endMs = 4000;
  word.beginMs = 2000; word.endMs = 3000;
  word.rubyUnits = [{ id: 'ruby', reading: 'ごうせい', beginMs: 2000, endMs: 2001 }];
  const props = { document, selectedLineId: line.id, selectedRomanization: null, startMs: 0, endMs: 5000, bpm: 0, snap: false,
    visible: { line: true, word: true, ruby: true, gap: false }, apply: vi.fn(), onSelectLine: vi.fn(), onPan: vi.fn(), onError: vi.fn() };
  const { rerender } = render(<TimelineTracks {...props} positionMs={0} />);
  for (const [positionMs, expected] of [[1000, [true, false, false]], [2000, [true, true, true]], [2001, [true, true, false]], [3000, [true, false, false]], [4000, [false, false, false]]] as const) {
    rerender(<TimelineTracks {...props} positionMs={positionMs} />);
    for (const [index, kind] of ['行', '词', '注音'].entries()) expect(screen.getByRole('button', { name: new RegExp(`^时间轴${kind} `) }).className.includes('trackPlaying')).toBe(expected[index]);
  }
  vi.unstubAllGlobals();
});

it('packs only visible intervals, retains crossing objects and freezes editing lanes until cancellation', async () => {
  const { fireEvent, cleanup } = await import('@testing-library/react'); cleanup();
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  const { createLine } = await import('../domain/lyric-document');
  const document = createLyricDocument();
  document.lines = [[0, 3], [1, 4], [5, 6], [6, 7]].map(([beginMs, endMs], i) => ({ ...createLine('', String(i)), beginMs: beginMs * 1e3, endMs: endMs * 1e3 }));
  const props = { document, selectedLineId: '2', selectedRomanization: null, startMs: 0, endMs: 8e3, positionMs: 0, bpm: 0, snap: false, visible: { line: true, word: false, ruby: false, gap: false }, apply: vi.fn(), onSelectLine: vi.fn(), onPan: vi.fn(), onError: vi.fn() };
  const { rerender } = render(<TimelineTracks {...props} />);
  const bar = screen.getByRole('button', { name: '时间轴行 L3' });
  const lane = bar.parentElement!;
  expect(lane.style.height).toBe('44px'); expect(bar.style.top).toBe('1px');
  bar.setPointerCapture = vi.fn();
  fireEvent.pointerDown(bar, { clientX: 100, pointerId: 1 });
  rerender(<TimelineTracks {...props} startMs={5.5e3} endMs={7e3} />);
  expect(lane.style.height).toBe('44px'); expect(bar.style.top).toBe('1px');
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(lane.style.height).toBe('22px');
  expect(screen.getByRole('button', { name: '时间轴行 L3' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '时间轴行 L1' })).not.toBeInTheDocument();
  cleanup(); vi.unstubAllGlobals();
});
