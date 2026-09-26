import { expect, it } from 'vitest';
import { computeSpectrogram, SPECTRUM_HEIGHT, SPECTRUM_WIDTH } from '../src/domain/spectrogram';

it('places a 440 Hz tone above silence in the correct spectral band', () => {
  const rate = 16_000, seconds = 2;
  const tone = Int16Array.from({ length: rate * seconds }, (_, index) => Math.round(Math.sin(index * 2 * Math.PI * 440 / rate) * 20_000));
  const output = computeSpectrogram(tone, rate, 1);
  const silent = computeSpectrogram(new Int16Array(rate * seconds), rate, 1);
  expect(output).toHaveLength(SPECTRUM_WIDTH * SPECTRUM_HEIGHT);
  const center = Math.floor(SPECTRUM_WIDTH / 2);
  const row = SPECTRUM_HEIGHT - 1 - Math.round(Math.log(440 / 80) / Math.log((rate / 2) / 80) * (SPECTRUM_HEIGHT - 1));
  expect(output[row * SPECTRUM_WIDTH + center]).toBeGreaterThan(100);
  expect(silent[row * SPECTRUM_WIDTH + center]).toBe(0);
});
