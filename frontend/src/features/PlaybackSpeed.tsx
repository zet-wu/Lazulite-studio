import { useEffect, useRef } from 'react';
import { normalizePlaybackSpeed, speedWheelSteps } from '../domain/playback-speed';
import styles from './media.module.css';

export function PlaybackSpeed({ rate, disabled, change }: { rate: number; disabled: boolean; change: (rate: number) => void }) {
  const area = useRef<HTMLDivElement>(null);
  const value = useRef(rate); value.current = rate;
  const remainder = useRef(0);
  useEffect(() => {
    const element = area.current!;
    const wheel = (event: WheelEvent) => {
      if (disabled || !event.deltaY || event.ctrlKey || event.metaKey) return;
      event.preventDefault(); event.stopPropagation();
      const result = speedWheelSteps(event.deltaY, event.deltaMode, remainder.current, element.clientHeight);
      remainder.current = result.remainder;
      if (result.steps) {
        value.current = normalizePlaybackSpeed(value.current - result.steps * .05);
        change(value.current);
      }
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, [disabled, change]);
  return <div ref={area} className={styles.playbackSpeed} aria-label="速度控件">
    <label>速度 <input type="range" aria-label="播放速度" aria-valuetext={`${rate.toFixed(2)}倍`} min="0.1" max="2" step="0.05" value={rate} disabled={disabled} onChange={event => { remainder.current = 0; change(normalizePlaybackSpeed(Number(event.target.value))); }} /></label>
    <output aria-live="off">{rate.toFixed(2)}×</output>
    <button data-role="secondary" disabled={disabled || rate === 1} aria-label="恢复 1 倍速度" onClick={() => { remainder.current = 0; change(1); }}>1×</button>
  </div>;
}
