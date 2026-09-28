export type Interval = { key: string; beginUs: number; endUs: number };

/** Deterministic interval partitioning. Touching endpoints can share a lane. */
export function packIntervals(intervals: readonly Interval[]) {
  const heap: { endUs: number; lane: number }[] = [];
  const lanes = new Map<string, number>();
  let laneCount = 0;
  const before = (a: typeof heap[number], b: typeof heap[number]) => a.endUs < b.endUs || a.endUs === b.endUs && a.lane < b.lane;
  const push = (value: typeof heap[number]) => {
    heap.push(value);
    for (let i = heap.length - 1; i > 0;) {
      const parent = (i - 1) >> 1;
      if (!before(heap[i], heap[parent])) break;
      [heap[i], heap[parent]] = [heap[parent], heap[i]]; i = parent;
    }
  };
  const pop = () => {
    const result = heap[0], last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      for (let i = 0;;) {
        let child = i * 2 + 1;
        if (child >= heap.length) break;
        if (child + 1 < heap.length && before(heap[child + 1], heap[child])) child++;
        if (!before(heap[child], heap[i])) break;
        [heap[i], heap[child]] = [heap[child], heap[i]]; i = child;
      }
    }
    return result;
  };
  for (const item of [...intervals].sort((a, b) => a.beginUs - b.beginUs || a.endUs - b.endUs || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))) {
    const lane = heap.length && heap[0].endUs <= item.beginUs ? pop().lane : laneCount++;
    lanes.set(item.key, lane); push({ endUs: item.endUs, lane });
  }
  return { lanes, laneCount };
}
