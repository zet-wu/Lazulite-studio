import { describe, expect, it } from 'vitest';
import { panViewport, waveformRequestWindow, zoomViewport } from '../src/domain/timeline-viewport';

describe('timeline viewport', () => {
  it('holds the pointer time at 25% and 75% while zooming', () => {
    const view = { startUs: 10_000_000, spanUs: 20_000_000 };
    for (const u of [0.25, 0.75]) {
      const next = zoomViewport(view, 60_000_000, 0.5, u);
      expect(next.startUs + u * next.spanUs).toBe(view.startUs + u * view.spanUs);
    }
  });

  it('clamps zoom and pan to duration and reuses a quantized fetch window', () => {
    expect(zoomViewport({ startUs: 0, spanUs: 40_000_000 }, 40_000_000, 100, 0.25)).toEqual({ startUs: 0, spanUs: 40_000_000 });
    expect(panViewport({ startUs: 10_000_000, spanUs: 10_000_000 }, 40_000_000, 50_000_000)).toEqual({ startUs: 30_000_000, spanUs: 10_000_000 });
    expect(waveformRequestWindow({ startUs: 10_100_000, spanUs: 8_000_000 }, 40_000_000))
      .toEqual(waveformRequestWindow({ startUs: 10_200_000, spanUs: 8_000_000 }, 40_000_000));
  });
});

it('P4 allows existing zoom to expose millisecond endpoints and clamps at 10ms', () => {
  const next = zoomViewport({ startUs: 2_000_000, spanUs: 1_000_000 }, 120_000_000, 0.001, 0);
  expect(next).toEqual({ startUs: 2_000_000, spanUs: 10_000 });
  expect(zoomViewport({ startUs: 0, spanUs: 5000 }, 5000, 0.5, 0)).toEqual({ startUs: 0, spanUs: 5000 });
});
