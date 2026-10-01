/** Estimate a beat interval from a 10 ms waveform envelope. */
export function estimateBpm(minimum: number[], maximum: number[], bucketMs: number): number | null {
  if (minimum.length !== maximum.length || minimum.length < 300 || bucketMs <= 0) return null;
  const energy = maximum.map((value, index) => Math.max(Math.abs(value), Math.abs(minimum[index])));
  const onset = energy.map((value, index) => Math.max(0, value - (energy[index - 1] ?? 0)));
  const total = onset.reduce((sum, value) => sum + value, 0);
  if (total < 0.5) return null;
  let best = { bpm: 0, score: 0 };
  const minLag = Math.max(2, Math.ceil(60_000 / 200 / bucketMs));
  const maxLag = Math.min(Math.floor(onset.length / 2), Math.floor(60_000 / 60 / bucketMs));
  for (let lag = minLag; lag <= maxLag; lag++) {
    let score = 0;
    for (let index = lag; index < onset.length; index++) score += onset[index] * onset[index - lag];
    if (score > best.score) best = { bpm: Math.round(60_000 / lag / bucketMs), score };
  }
  return best.score > 0.05 ? best.bpm : null;
}
