import { useCallback, useEffect, useState, type RefObject } from 'react';

/** Observe each mounted canvas, including equal-sized replacements in portals. */
export function useCanvasMetrics(ref: RefObject<HTMLCanvasElement | null>, enabled = true) {
  const [node, setNode] = useState<HTMLCanvasElement | null>(null);
  const [metrics, setMetrics] = useState({ width: 640, height: 0, ratio: window.devicePixelRatio || 1 });
  const observe = useCallback((canvas: HTMLCanvasElement | null) => {
    ref.current = canvas;
    setNode(canvas);
  }, [ref]);
  useEffect(() => {
    if (!node || !enabled) return;
    let resolution: MediaQueryList;
    const measure = () => {
      const { width, height } = node.getBoundingClientRect();
      setMetrics({ width, height, ratio: window.devicePixelRatio || 1 });
    };
    const changed = () => {
      resolution.removeEventListener('change', changed);
      measure(); watch();
    };
    const watch = () => { resolution = matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`); resolution.addEventListener('change', changed); };
    const observer = new ResizeObserver(measure);
    observer.observe(node); watch(); measure();
    return () => { observer.disconnect(); resolution.removeEventListener('change', changed); };
  }, [node, enabled]);
  return { ...metrics, node, observe };
}
