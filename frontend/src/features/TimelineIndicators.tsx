import { createContext, useContext } from 'react';
import styles from './media.module.css';

export type TimelinePreview = { timeMs: number; valid: boolean } | null;
export const TimelineIndicatorContext = createContext<{
  startMs: number; endMs: number; preview: TimelinePreview; publish: (preview: TimelinePreview) => void;
}>({ startMs: 0, endMs: 1, preview: null, publish: () => {} });

/** Playback position is projected by the transport clock through inherited CSS variables. */
export function TimelineIndicators({ playback = false }: { playback?: boolean }) {
  const { startMs, endMs, preview } = useContext(TimelineIndicatorContext);
  const visible = preview && preview.timeMs >= startMs && preview.timeMs <= endMs;
  return <>
    {playback && <span aria-hidden="true" data-playhead className={styles.playhead} />}
    {visible && <span aria-hidden="true" data-drag-guide data-preview-ms={preview.timeMs} data-valid={preview.valid}
      className={styles.dragGuide} style={{ left: `${(preview.timeMs - startMs) / Math.max(1, endMs - startMs) * 100}%` }} />}
  </>;
}
