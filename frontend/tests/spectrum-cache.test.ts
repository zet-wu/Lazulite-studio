import { expect, it } from 'vitest';
import { SpectrumCache, SPECTRUM_CACHE_LIMIT } from '../src/features/spectrum-cache';
import { SPECTRUM_HEIGHT, SPECTRUM_WIDTH } from '../src/domain/spectrogram';
it('bounds intensity tiles and evicts the least recently used', () => {
  const cache = new SpectrumCache();
  for (let i = 0; i < SPECTRUM_CACHE_LIMIT; i++) cache.set({ startMs: i, endMs: i + 1, pixels: new Uint8Array(SPECTRUM_WIDTH * SPECTRUM_HEIGHT) });
  cache.get(0);
  cache.set({ startMs: SPECTRUM_CACHE_LIMIT, endMs: SPECTRUM_CACHE_LIMIT + 1, pixels: new Uint8Array(SPECTRUM_WIDTH * SPECTRUM_HEIGHT) });
  expect(cache.size).toBe(SPECTRUM_CACHE_LIMIT); expect(cache.get(0)).toBeDefined(); expect(cache.get(1)).toBeUndefined(); expect(cache.evictions).toBe(1);
});
