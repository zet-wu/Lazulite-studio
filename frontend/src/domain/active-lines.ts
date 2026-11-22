import type { LyricLine } from './lyric-document';

type TimedLine = { id: string; order: number; beginMs: number; endMs: number };

export function createActiveLineTracker(lines: readonly LyricLine[], mainOnly = false) {
  const items: TimedLine[] = [];
  for (let order = 0; order < lines.length; order++) {
    const line = lines[order];
    if (mainOnly && line.backgroundOf) continue;
    if (line.beginMs !== null && line.endMs !== null && line.beginMs < line.endMs) {
      items.push({ id: line.id, order, beginMs: line.beginMs, endMs: line.endMs });
    }
  }
  items.sort((a, b) => a.beginMs - b.beginMs || a.order - b.order);
  const prefixMaxEnd = new Int32Array(items.length);
  let maxEnd = 0;
  for (let i = 0; i < items.length; i++) {
    if (items[i].endMs > maxEnd) maxEnd = items[i].endMs;
    prefixMaxEnd[i] = maxEnd;
  }

  let validFrom = 0;
  let validUntil = -1;
  let cachedFirstId: string | null = null;
  let cachedKey = '';

  const evaluate = (ms: number) => {
    if (ms >= validFrom && ms < validUntil) return;
    let lo = 0;
    let hi = items.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (items[mid].beginMs <= ms) lo = mid + 1;
      else hi = mid;
    }
    let nextUntil = lo < items.length ? items[lo].beginMs : Infinity;
    const active: TimedLine[] = [];
    for (let i = lo - 1; i >= 0 && prefixMaxEnd[i] > ms; i--) {
      const item = items[i];
      if (item.endMs > ms) {
        if (item.endMs < nextUntil) nextUntil = item.endMs;
        active.push(item);
      }
    }
    validFrom = ms;
    validUntil = nextUntil;
    if (!active.length) {
      cachedFirstId = null;
      cachedKey = '';
      return;
    }
    if (active.length === 1) {
      cachedFirstId = active[0].id;
      cachedKey = active[0].id;
      return;
    }
    active.sort((a, b) => a.order - b.order);
    cachedFirstId = active[0].id;
    cachedKey = active.map(item => item.id).join(',');
  };

  return {
    firstId(ms: number): string | null {
      evaluate(ms);
      return cachedFirstId;
    },
    key(ms: number): string {
      evaluate(ms);
      return cachedKey;
    },
  };
}
