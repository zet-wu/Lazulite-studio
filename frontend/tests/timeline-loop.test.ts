import { describe, expect, it } from 'vitest';
import { captureLoop, emptyLoop, loopRange, setLoopA, setLoopB } from '../src/domain/timeline-loop';

describe('single A/B loop', () => {
  it('captures a precise numeric range independent of later selection changes', () => {
    const selected = { beginUs: 1_000_001, endUs: 2_000_000 };
    const loop = captureLoop(selected.beginUs, selected.endUs, 10_000_000);
    selected.beginUs = 4_000_000;
    expect(loopRange(loop, 10_000_000)).toEqual([1_000_001, 2_000_000]);
    expect(loopRange({ ...loop, enabled: false }, 10_000_000)).toBeNull();
  });

  it('requires valid boundaries and clears them for a new asset', () => {
    expect(() => captureLoop(2, 2, 10)).toThrow(/A < B/);
    const withA = setLoopA(emptyLoop(), 1_000_000, 5_000_000);
    expect(setLoopB(withA, 2_000_000, 5_000_000)).toMatchObject({ aUs: 1_000_000, bUs: 2_000_000 });
    expect(() => setLoopB(withA, 500_000, 5_000_000)).toThrow(/晚于 A/);
    expect(loopRange(emptyLoop(), 5_000_000)).toBeNull();
  });
});
