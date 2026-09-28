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

import { PROXY_SAMPLE_RATE, sampleTimestamp, spectrumWindow } from '../src/domain/spectrogram';

it('matches full PCM analysis to padded tiles across tone/noise/transient boundaries and a short tail', () => {
  const rate = PROXY_SAMPLE_RATE, durationUs = 8_123_000, frames = Math.round(durationUs * rate / 1e6);
  let random = 12345;
  const pcm = Int16Array.from({ length: frames * 2 }, (_, index) => {
    const frame = Math.floor(index / 2);
    random = (random * 1664525 + 1013904223) >>> 0;
    return Math.round(9000 * Math.sin(frame * 2 * Math.PI * 440 / rate) + (random / 2 ** 32 - 0.5) * 4000 + (Math.abs(frame - 4 * rate) < 100 ? 10000 : 0));
  });
  for (const start of [0, 4_000_000, 8_000_000]) {
    const end = Math.min(start + 4_000_000, durationUs), window = spectrumWindow(start, end, durationUs);
    const first = Math.round(window.requestStartUs * rate / 1e6), last = Math.round(window.requestEndUs * rate / 1e6);
    const tiled = computeSpectrogram(pcm.slice(first * 2, last * 2), rate, 2, window);
    const whole = computeSpectrogram(pcm, rate, 2, { ...window, requestStartUs: 0, requestEndUs: durationUs });
    expect(tiled).toEqual(whole);
    expect(window.requestEndUs - window.requestStartUs).toBeLessThanOrEqual(4_020_000);
  }
});

it('requests integer microseconds away from half-sample ties and rejects missing internal context', () => {
  for (const frame of [0, 1, 2, 255, 256, 191744, 192000, 192256]) {
    expect(Math.round(sampleTimestamp(frame) * PROXY_SAMPLE_RATE / 1e6)).toBe(frame);
    expect(Math.abs(sampleTimestamp(frame) * PROXY_SAMPLE_RATE / 1e6 - frame)).toBeLessThan(0.5);
  }
  const window = spectrumWindow(4_000_000, 8_000_000, 12_000_000);
  expect(() => computeSpectrogram(new Int16Array(100), PROXY_SAMPLE_RATE, 1, window)).toThrow('上下文');
});
