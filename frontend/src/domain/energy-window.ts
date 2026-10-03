export type EnergyWindow = { start_ms: number; step_ms: number; values: number[] };

/** Select only buckets intersecting the visible interval, never the prefetch margin. */
export function visibleEnergy(data: EnergyWindow | undefined, startMs: number, endMs: number) {
  if (!data) return null;
  const first = Math.max(0, Math.floor((startMs - data.start_ms) / data.step_ms));
  const last = Math.min(data.values.length, Math.ceil((endMs - data.start_ms) / data.step_ms));
  if (last <= first) return null;
  const values = data.values.slice(first, last);
  const upper = Math.max(.01, Math.ceil((Math.max(0, ...values) * 1.1 - 1e-12) * 100) / 100);
  return { start_ms: data.start_ms + first * data.step_ms, step_ms: data.step_ms, values, upper };
}
