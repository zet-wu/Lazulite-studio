import type { ReadingRange } from '../../domain/japanese-ruby';
import { requestHeaders } from "./client";

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
  if (!response.ok) {
    let message = `读音请求失败（${response.status}）`;
    try {
      const body = (await response.json()) as { message?: string };
      message = body.message ?? message;
    } catch {
      /* keep the status message */
    }
    throw new Error(message);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}



export const analyzeReadings = (lines: Array<{ id: string; text: string }>, signal: AbortSignal) =>
  call<{ ranges: ReadingRange[] }>('/reading/analyze', { method: 'POST', body: JSON.stringify({ lines }), signal });
