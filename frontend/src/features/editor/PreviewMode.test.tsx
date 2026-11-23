import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLyricDocument, createWord } from '../../domain/lyric-document';
import type { TransportHandle } from '../MediaTransport';
import { PreviewMode } from './PreviewMode';
import { StudioLyricPlayer } from './StudioLyricPlayer';

function makeDoc(text = 'Line one') {
  const doc = createLyricDocument('');
  doc.lines[0] = {
    ...doc.lines[0],
    id: 'l1',
    beginMs: 1000,
    endMs: 4000,
    words: [{ ...createWord(text, 'w1'), beginMs: 1000, endMs: 4000 }],
  };
  doc.translationTracks = [
    {
      id: 't1',
      language: 'zh-Hans',
      contents: [{ id: 'tc1', lineId: 'l1', kind: 'plain', text: '第一行' }],
    },
  ];
  doc.romanizationTracks = [
    {
      id: 'r1',
      language: 'ja-Latn',
      contents: [{ id: 'rc1', lineId: 'l1', kind: 'plain', text: 'dai ichi' }],
    },
  ];
  return doc;
}

describe('PreviewMode paused sync', () => {
  const originalGetAnimations = HTMLElement.prototype.getAnimations;
  const originalResizeObserver = globalThis.ResizeObserver;
  const originalCss = globalThis.CSS;

  beforeEach(() => {
    localStorage.clear();
    if (!HTMLElement.prototype.getAnimations) {
      HTMLElement.prototype.getAnimations = () => [];
    }
    if (!globalThis.ResizeObserver) {
      globalThis.ResizeObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
      } as unknown as typeof ResizeObserver;
    }
    globalThis.CSS = { ...(originalCss ?? {}), supports: () => false } as typeof CSS;
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    HTMLElement.prototype.getAnimations = originalGetAnimations;
    globalThis.ResizeObserver = originalResizeObserver;
    globalThis.CSS = originalCss;
  });

  it('re-syncs paused playhead after toggling translation, toggling romanization, and updating lyrics', async () => {
    const setTimeSpy = vi.spyOn(StudioLyricPlayer.prototype, 'setCurrentTime');
    const setLinesSpy = vi.spyOn(StudioLyricPlayer.prototype, 'setLyricLines');

    const transport = createRef<TransportHandle | null>();
    transport.current = {
      seekMs: vi.fn(),
      play: vi.fn(),
      pause: vi.fn(),
      toggle: vi.fn(),
      step: vi.fn(),
      getPositionMs: () => 2000,
      getPlaybackRate: () => 1,
      isPlaying: () => false,
    };

    const { rerender } = render(<PreviewMode document={makeDoc('Line one')} transport={transport} />);
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    expect(setTimeSpy).toHaveBeenCalledWith(2000);

    // 1. Toggle translation off while paused
    setTimeSpy.mockClear();
    setLinesSpy.mockClear();
    fireEvent.click(screen.getByRole('checkbox', { name: '翻译' }));
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    expect(setLinesSpy).toHaveBeenCalledTimes(1);
    expect(setTimeSpy).toHaveBeenLastCalledWith(2000);

    // 2. Toggle romanization off while paused
    setTimeSpy.mockClear();
    setLinesSpy.mockClear();
    fireEvent.click(screen.getByRole('checkbox', { name: '音译' }));
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    expect(setLinesSpy).toHaveBeenCalledTimes(1);
    expect(setTimeSpy).toHaveBeenLastCalledWith(2000);

    // 3. Update document lyrics (e.g. external revision) while paused
    setTimeSpy.mockClear();
    setLinesSpy.mockClear();
    rerender(<PreviewMode document={makeDoc('External updated')} transport={transport} />);
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    expect(setLinesSpy).toHaveBeenCalledTimes(1);
    expect(setTimeSpy).toHaveBeenLastCalledWith(2000);
  });
});
