import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { createLyricDocument } from '../domain/lyric-document';
import { TimelineTracks } from './TimelineTracks';

it('uses half-open independent intervals across line, word and Ruby at seek and paused positions', () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  const document = createLyricDocument('合成');
  const line = document.lines[0], word = line.words[0];
  line.beginUs = 1_000_000; line.endUs = 4_000_000;
  word.beginUs = 2_000_000; word.endUs = 3_000_000;
  word.rubyUnits = [{ id: 'ruby', reading: 'ごうせい', beginUs: 2_000_000, endUs: 2_001_000 }];
  const props = { document, selectedLineId: line.id, selectedRomanization: null, startUs: 0, endUs: 5_000_000, bpm: 0, snap: false,
    visible: { line: true, word: true, ruby: true, gap: false }, apply: vi.fn(), onSelectLine: vi.fn(), onPan: vi.fn(), onError: vi.fn() };
  const { rerender } = render(<TimelineTracks {...props} positionUs={0} />);
  for (const [positionUs, expected] of [[1_000_000, [true, false, false]], [2_000_000, [true, true, true]], [2_001_000, [true, true, false]], [3_000_000, [true, false, false]], [4_000_000, [false, false, false]]] as const) {
    rerender(<TimelineTracks {...props} positionUs={positionUs} />);
    for (const [index, kind] of ['行', '词', 'Ruby'].entries()) expect(screen.getByRole('button', { name: new RegExp(`^时间轴${kind} `) }).className.includes('trackPlaying')).toBe(expected[index]);
  }
  vi.unstubAllGlobals();
});
