import type { ReadingRange } from '../../domain/japanese-ruby';
import { apiJson } from "./client";

export const analyzeReadings = (lines: Array<{ id: string; text: string }>, signal: AbortSignal, autoMerge = false) =>
  apiJson<{ ranges: ReadingRange[] }>('/reading/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lines, auto_merge: autoMerge }),
    signal,
  });
