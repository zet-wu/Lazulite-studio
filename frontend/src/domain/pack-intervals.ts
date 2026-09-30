export type Interval = { key: string; beginUs: number; endUs: number };

function minHeap<T>(before: (a: T, b: T) => boolean) {
  const heap: T[] = [];
  return {
    peek: () => heap[0],
    push(value: T) {
      heap.push(value);
      for (let i = heap.length - 1; i > 0;) {
        const parent = (i - 1) >> 1;
        if (!before(heap[i], heap[parent])) break;
        [heap[i], heap[parent]] = [heap[parent], heap[i]]; i = parent;
      }
    },
    pop() {
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
    },
  };
}

/** Exact interval partitioning, reusing the lowest free lane. O(n log n). */
export function packIntervals(intervals: readonly Interval[]) {
  const busy = minHeap<{ endUs: number; lane: number }>((a, b) => a.endUs < b.endUs || a.endUs === b.endUs && a.lane < b.lane);
  const free = minHeap<number>((a, b) => a < b);
  const lanes = new Map<string, number>();
  let laneCount = 0;
  for (const item of [...intervals].sort((a, b) => a.beginUs - b.beginUs || a.endUs - b.endUs || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))) {
    while (busy.peek() && busy.peek().endUs <= item.beginUs) free.push(busy.pop().lane);
    const lane = free.peek() === undefined ? laneCount++ : free.pop();
    lanes.set(item.key, lane); busy.push({ endUs: item.endUs, lane });
  }
  return { lanes, laneCount };
}
