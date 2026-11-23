import { expect, it } from 'vitest';
import { SpectrumCache, SPECTRUM_CACHE_LIMIT } from '../src/features/spectrum-cache';
import { SPECTRUM_HEIGHT, SPECTRUM_WIDTH } from '../src/domain/spectrogram';
it('bounds intensity tiles and evicts the least recently used', () => {
  const cache = new SpectrumCache();
  for (let i = 0; i < SPECTRUM_CACHE_LIMIT; i++) cache.set({ startMs: i, endMs: i + 1, pixels: new Uint8Array(SPECTRUM_WIDTH * SPECTRUM_HEIGHT) });
  cache.get(0);
  cache.set({ startMs: SPECTRUM_CACHE_LIMIT, endMs: SPECTRUM_CACHE_LIMIT + 1, pixels: new Uint8Array(SPECTRUM_WIDTH * SPECTRUM_HEIGHT) });
  expect(cache.size).toBe(SPECTRUM_CACHE_LIMIT); expect(cache.get(0)).toBeDefined(); expect(cache.get(1)).toBeUndefined();
});

it('releases colored canvas storage on replacement, eviction and clear', () => {
  const cache = new SpectrumCache();
  const canvas = () => Object.assign(document.createElement('canvas'), { width: SPECTRUM_WIDTH, height: SPECTRUM_HEIGHT });
  const first = canvas(), replacement = canvas();
  cache.set({ startMs: 0, endMs: 1, bitmap: first });
  cache.set({ startMs: 0, endMs: 1, bitmap: replacement });
  expect([first.width, first.height]).toEqual([0, 0]);
  for (let index = 1; index <= SPECTRUM_CACHE_LIMIT; index++) cache.set({ startMs: index, endMs: index + 1, bitmap: canvas() });
  expect([replacement.width, replacement.height]).toEqual([0, 0]);
  const last = cache.get(SPECTRUM_CACHE_LIMIT)!, bitmap = last.bitmap!;
  cache.clear();
  expect(cache.size).toBe(0); expect(last.bitmap).toBeUndefined(); expect(last.pixels).toBeUndefined();
  expect([bitmap.width, bitmap.height]).toEqual([0, 0]);
});
