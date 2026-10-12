import { describe, expect, it } from 'vitest';
import { panViewport, waveformRequestWindow, zoomViewport } from '../src/domain/timeline-viewport';

describe('timeline viewport', () => {
  it('holds the pointer time at 25% and 75% while zooming', () => {
    const view = { startMs: 10000, spanMs: 20000 };
    for (const u of [0.25, 0.75]) {
      const next = zoomViewport(view, 60000, 0.5, u);
      expect(next.startMs + u * next.spanMs).toBe(view.startMs + u * view.spanMs);
    }
  });

  it('clamps zoom and pan to duration and reuses a quantized fetch window', () => {
    expect(zoomViewport({ startMs: 0, spanMs: 40000 }, 40000, 100, 0.25)).toEqual({ startMs: 0, spanMs: 40000 });
    expect(panViewport({ startMs: 10000, spanMs: 10000 }, 40000, 50000)).toEqual({ startMs: 30000, spanMs: 10000 });
    expect(waveformRequestWindow({ startMs: 10100, spanMs: 8000 }, 40000))
      .toEqual(waveformRequestWindow({ startMs: 10200, spanMs: 8000 }, 40000));
  });
});

it('allows existing zoom to expose millisecond endpoints and clamps at 10ms', () => {
  const next = zoomViewport({ startMs: 2000, spanMs: 1000 }, 120000, 0.001, 0);
  expect(next).toEqual({ startMs: 2000, spanMs: 10 });
  expect(zoomViewport({ startMs: 0, spanMs: 5 }, 5, 0.5, 0)).toEqual({ startMs: 0, spanMs: 5 });
});
