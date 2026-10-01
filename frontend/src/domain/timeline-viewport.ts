export type TimelineViewport = { startMs: number; spanMs: number };

export function clampViewport(view: TimelineViewport, durationMs: number): TimelineViewport {
  if (durationMs <= 0) return { startMs: 0, spanMs: 0 };
  const spanMs = Math.max(Math.min(durationMs, 10), Math.min(durationMs, Math.round(view.spanMs)));
  return { startMs: Math.max(0, Math.min(durationMs - spanMs, Math.round(view.startMs))), spanMs };
}

export function zoomViewport(view: TimelineViewport, durationMs: number, factor: number, anchorFraction: number): TimelineViewport {
  if (!Number.isFinite(factor) || factor <= 0) throw new Error('缩放比例必须大于零');
  const u = Math.max(0, Math.min(1, anchorFraction));
  const next = clampViewport({ startMs: 0, spanMs: view.spanMs * factor }, durationMs);
  return clampViewport({ startMs: view.startMs + u * view.spanMs - u * next.spanMs, spanMs: next.spanMs }, durationMs);
}

export function panViewport(view: TimelineViewport, durationMs: number, deltaMs: number): TimelineViewport {
  return clampViewport({ ...view, startMs: view.startMs + deltaMs }, durationMs);
}

export function waveformRequestWindow(view: TimelineViewport, durationMs: number): { startMs: number; endMs: number } {
  if (!durationMs || !view.spanMs) return { startMs: 0, endMs: 0 };
  const step = Math.max(250, Math.round(view.spanMs / 4));
  const startMs = Math.max(0, Math.floor(view.startMs / step) * step - step);
  const endMs = Math.min(durationMs, Math.ceil((view.startMs + view.spanMs) / step) * step + step);
  return { startMs, endMs };
}
