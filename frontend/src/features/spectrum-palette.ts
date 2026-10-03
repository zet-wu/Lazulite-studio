// Fixed display-only ramp: near-black purple → red-orange → pale yellow.
// Keep the acoustic intensity range and tile cache independent of display colors.
const stops = [
  [4, 2, 12], [48, 18, 75], [112, 35, 96], [184, 65, 82],
  [235, 121, 56], [250, 187, 78], [252, 249, 191],
];
export const spectrumPalette = Array.from({ length: 256 }, (_, intensity) => {
  const position = intensity / 255 * (stops.length - 1);
  const index = Math.min(Math.floor(position), stops.length - 2);
  const fraction = position - index;
  return stops[index].map((channel, component) => Math.round(channel + (stops[index + 1][component] - channel) * fraction));
});
