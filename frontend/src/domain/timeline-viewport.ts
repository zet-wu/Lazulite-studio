export type TimelineViewport = { startUs: number; spanUs: number };

export function clampViewport(view: TimelineViewport, durationUs: number): TimelineViewport {
  if (durationUs <= 0) return { startUs: 0, spanUs: 0 };
  const spanUs = Math.max(Math.min(durationUs, 10_000), Math.min(durationUs, Math.round(view.spanUs)));
  return { startUs: Math.max(0, Math.min(durationUs - spanUs, Math.round(view.startUs))), spanUs };
}

export function zoomViewport(view: TimelineViewport, durationUs: number, factor: number, anchorFraction: number): TimelineViewport {
  if (!Number.isFinite(factor) || factor <= 0) throw new Error('缩放比例必须大于零');
  const u = Math.max(0, Math.min(1, anchorFraction));
  const next = clampViewport({ startUs: 0, spanUs: view.spanUs * factor }, durationUs);
  return clampViewport({ startUs: view.startUs + u * view.spanUs - u * next.spanUs, spanUs: next.spanUs }, durationUs);
}

export function panViewport(view: TimelineViewport, durationUs: number, deltaUs: number): TimelineViewport {
  return clampViewport({ ...view, startUs: view.startUs + deltaUs }, durationUs);
}

export function waveformRequestWindow(view: TimelineViewport, durationUs: number): { startUs: number; endUs: number } {
  if (!durationUs || !view.spanUs) return { startUs: 0, endUs: 0 };
  const step = Math.max(250_000, Math.round(view.spanUs / 4));
  const startUs = Math.max(0, Math.floor(view.startUs / step) * step - step);
  const endUs = Math.min(durationUs, Math.ceil((view.startUs + view.spanUs) / step) * step + step);
  return { startUs, endUs };
}
