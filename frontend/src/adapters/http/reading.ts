import type { ReadingRange } from '../../domain/japanese-ruby';
import { requestHeaders, readApiError } from "./client";

const root = "/api/v1";

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${root}${path}`, {
    credentials: "include",
    ...init,
    headers: requestHeaders({
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    }),
  });
  if (!response.ok) throw await readApiError(response);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}



export const analyzeReadings = (lines: Array<{ id: string; text: string }>, signal: AbortSignal) =>
  call<{ ranges: ReadingRange[] }>('/reading/analyze', { method: 'POST', body: JSON.stringify({ lines }), signal });
