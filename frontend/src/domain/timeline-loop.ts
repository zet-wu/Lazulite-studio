import { message, MessageError } from './messages';
export type LoopState = { enabled: boolean; aMs: number | null; bMs: number | null };
export const emptyLoop = (): LoopState => ({ enabled: false, aMs: null, bMs: null });

export function loopRange(loop: LoopState, durationMs: number): readonly [number, number] | null {
  return loop.enabled && loop.aMs !== null && loop.bMs !== null && loop.aMs >= 0 && loop.aMs < loop.bMs && loop.bMs <= durationMs
    ? [loop.aMs, loop.bMs] : null;
}

export function captureLoop(aMs: number, bMs: number, durationMs: number): LoopState {
  if (!Number.isSafeInteger(aMs) || !Number.isSafeInteger(bMs) || aMs < 0 || aMs >= bMs || bMs > durationMs) throw new MessageError(message('loop.rangeInvalid'));
  return { enabled: true, aMs, bMs };
}

export function setLoopA(loop: LoopState, aMs: number, durationMs: number): LoopState {
  if (!Number.isSafeInteger(aMs) || aMs < 0 || aMs > durationMs) throw new MessageError(message('loop.startOutside'));
  const bMs = loop.bMs !== null && loop.bMs > aMs ? loop.bMs : null;
  return { enabled: loop.enabled && bMs !== null, aMs, bMs };
}

export function setLoopB(loop: LoopState, bMs: number, durationMs: number): LoopState {
  if (!Number.isSafeInteger(bMs) || loop.aMs === null || bMs <= loop.aMs || bMs > durationMs) throw new MessageError(message('loop.endInvalid'));
  return { ...loop, bMs };
}
