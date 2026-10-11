export const normalizePlaybackSpeed = (value: number) => Math.max(.1, Math.min(2, Math.round(value * 20) / 20));
/** Accumulate small trackpad deltas; line/page deltas are converted to CSS pixels. */
export function speedWheelSteps(deltaY: number, deltaMode: number, remainder: number, pageHeight: number) {
  const pixels = deltaY * (deltaMode === 1 ? 16 : deltaMode === 2 ? pageHeight : 1);
  const total = remainder + pixels;
  const steps = Math.trunc(total / 40);
  return { steps, remainder: total - steps * 40 };
}
