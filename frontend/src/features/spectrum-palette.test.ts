import { expect, test } from 'vitest';
import { spectrumPalette } from './spectrum-palette';

const luminance = (rgb: number[]) => rgb.map(value => {
  const s = value / 255;
  return s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4;
}).reduce((sum, value, i) => sum + value * [.2126, .7152, .0722][i], 0);

test('all quantized intensities increase luminance with distinguishable dark and bright endpoints', () => {
  const levels = spectrumPalette.map(luminance);
  expect(levels[0]).toBeLessThan(.005);
  expect(levels.at(-1)).toBeGreaterThan(.9);
  levels.slice(1).forEach((level, i) => expect(level).toBeGreaterThan(levels[i]));
});
