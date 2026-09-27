export type LoopState = { enabled: boolean; aUs: number | null; bUs: number | null };
export const emptyLoop = (): LoopState => ({ enabled: false, aUs: null, bUs: null });

export function loopRange(loop: LoopState, durationUs: number): readonly [number, number] | null {
  return loop.enabled && loop.aUs !== null && loop.bUs !== null && loop.aUs >= 0 && loop.aUs < loop.bUs && loop.bUs <= durationUs
    ? [loop.aUs, loop.bUs] : null;
}

export function captureLoop(aUs: number, bUs: number, durationUs: number): LoopState {
  if (!Number.isSafeInteger(aUs) || !Number.isSafeInteger(bUs) || aUs < 0 || aUs >= bUs || bUs > durationUs) throw new Error('循环区间须满足 0 ≤ A < B ≤ 媒体时长');
  return { enabled: true, aUs, bUs };
}

export function setLoopA(loop: LoopState, aUs: number, durationUs: number): LoopState {
  if (!Number.isSafeInteger(aUs) || aUs < 0 || aUs > durationUs) throw new Error('A 超出媒体时长');
  const bUs = loop.bUs !== null && loop.bUs > aUs ? loop.bUs : null;
  return { enabled: loop.enabled && bUs !== null, aUs, bUs };
}

export function setLoopB(loop: LoopState, bUs: number, durationUs: number): LoopState {
  if (!Number.isSafeInteger(bUs) || loop.aUs === null || bUs <= loop.aUs || bUs > durationUs) throw new Error('B 必须晚于 A 且不超过媒体时长');
  return { ...loop, bUs };
}
