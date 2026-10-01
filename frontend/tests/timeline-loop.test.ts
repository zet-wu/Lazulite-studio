import { describe, expect, it } from 'vitest';
import { captureLoop, emptyLoop, loopRange, setLoopA, setLoopB } from '../src/domain/timeline-loop';

describe('single A/B loop', () => {
  it('captures a precise numeric range independent of later selection changes', () => {
    const selected = { beginMs: 1001, endMs: 2000 };
    const loop = captureLoop(selected.beginMs, selected.endMs, 10000);
    selected.beginMs = 4000;
    expect(loopRange(loop, 10000)).toEqual([1001, 2000]);
    expect(loopRange({ ...loop, enabled: false }, 10000)).toBeNull();
  });

  it('requires valid boundaries and clears them for a new asset', () => {
    expect(() => captureLoop(2, 2, 10)).toThrow(/A < B/);
    const withA = setLoopA(emptyLoop(), 1000, 5000);
    expect(setLoopB(withA, 2000, 5000)).toMatchObject({ aMs: 1000, bMs: 2000 });
    expect(() => setLoopB(withA, 500, 5000)).toThrow(/晚于 A/);
    expect(loopRange(emptyLoop(), 5000)).toBeNull();
  });
});
