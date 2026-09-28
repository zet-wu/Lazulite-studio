import { useEffect, useState, type RefObject } from 'react';

/** Resize and monitor moves between desktop displays with different DPR. */
export function useCanvasMetrics(ref: RefObject<HTMLCanvasElement | null>, enabled = true) {
  const [metrics, setMetrics] = useState({ width: 640, ratio: window.devicePixelRatio || 1 });
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !enabled) return;
    let resolution: MediaQueryList;
    const measure = () => setMetrics({ width: canvas.getBoundingClientRect().width, ratio: window.devicePixelRatio || 1 });
    const changed = () => {
      resolution.removeEventListener('change', changed);
      measure(); watch();
    };
    const watch = () => { resolution = matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`); resolution.addEventListener('change', changed); };
    const observer = new ResizeObserver(measure);
    observer.observe(canvas); watch(); measure();
    return () => { observer.disconnect(); resolution.removeEventListener('change', changed); };
  }, [ref, enabled]);
  return metrics;
}
