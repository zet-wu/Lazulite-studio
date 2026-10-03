import { expect, it } from 'vitest';
import { visibleEnergy } from '../src/domain/energy-window';
import { waveformRequestWindow } from '../src/domain/timeline-viewport';

it('prefetch peaks outside the visible interval do not change its energy scale', () => {
  const data = { start_ms: 0, step_ms: 100, values: [1, .003, .002, .8] };
  expect(visibleEnergy(data, 100, 300)).toEqual({start_ms:100,step_ms:100,values:[.003,.002],upper:.01});
  expect(visibleEnergy(data, 500, 700)).toBeNull();
  expect(visibleEnergy(undefined, 0, 100)).toBeNull();
  expect(visibleEnergy({...data, values:[0, 0]},0,200)?.upper).toBe(.01);
});

it('continuous follow requests scale with window crossings instead of animation frames', () => {
  const keys = new Set<string>();
  for(let t=10000;t<35000;t+=16) {
    const window = waveformRequestWindow({startMs:t,spanMs:8000},180000);
    expect(window.startMs).toBeLessThanOrEqual(t);
    expect(window.endMs).toBeGreaterThanOrEqual(t+8000);
    keys.add(JSON.stringify(window));
  }
  expect(keys.size).toBeLessThan(30);
});
