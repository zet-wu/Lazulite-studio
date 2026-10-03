import { expect, test } from 'vitest';
import { spectrumPalette } from './spectrum-palette';

const luminance = (rgb: number[]) => rgb.map(value => {
  const s = value / 255;
  return s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4;
}).reduce((sum, value, i) => sum + value * [.2126, .7152, .0722][i], 0);

test('all quantized intensities increase luminance with distinguishable dark and bright endpoints', () => {
  expect(spectrumPalette).toHaveLength(256);
  const levels = spectrumPalette.map(luminance);
  expect(levels[0]).toBeLessThan(.005);
  expect(levels[255]).toBeGreaterThan(.9);
  levels.slice(1).forEach((level, i) => expect(level).toBeGreaterThan(levels[i]));
  for (const status of [[16, 22, 34], [36, 53, 75], [80, 41, 51]]) {
    expect(spectrumPalette).not.toContainEqual(status);
  }
});
