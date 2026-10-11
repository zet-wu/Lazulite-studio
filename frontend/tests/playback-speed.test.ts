import { savedPlaybackSpeed, playbackSpeedKey } from '../src/adapters/playback-speed';
import { expect, it } from 'vitest';
import { normalizePlaybackSpeed, speedWheelSteps } from '../src/domain/playback-speed';
it('quantizes and clamps without accumulated floating point drift and restores valid preferences', () => {
  let rate = .1; for (let i = 0; i < 38; i++) rate = normalizePlaybackSpeed(rate + .05);
  expect(rate).toBe(2); for (let i = 0; i < 38; i++) rate = normalizePlaybackSpeed(rate - .05);
  expect(rate).toBe(.1); expect(normalizePlaybackSpeed(9)).toBe(2);
  localStorage.setItem(playbackSpeedKey, '0.25'); expect(savedPlaybackSpeed()).toBe(.25);
  localStorage.setItem(playbackSpeedKey, 'NaN'); expect(savedPlaybackSpeed()).toBe(1); localStorage.removeItem(playbackSpeedKey);
});
it('accumulates trackpad pixels and converts line and page deltas in both directions', () => {
  let remainder = 0;
  for (let i = 0; i < 3; i++) { const result = speedWheelSteps(10, 0, remainder, 40); expect(result.steps).toBe(0); remainder = result.remainder; }
  expect(speedWheelSteps(10, 0, remainder, 40)).toEqual({ steps: 1, remainder: 0 });
  expect(speedWheelSteps(-3, 1, 0, 40)).toEqual({ steps: -1, remainder: -8 });
  expect(speedWheelSteps(1, 2, 0, 40)).toEqual({ steps: 1, remainder: 0 });
});
