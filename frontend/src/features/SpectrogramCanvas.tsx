import { useEffect, useRef, useState } from 'react';
import { studioApi } from '../adapters/http/client';
import { SPECTRUM_HEIGHT, SPECTRUM_WIDTH } from '../domain/spectrogram';
import styles from './media.module.css';

const WINDOW_US = 4_000_000;
type Tile = { startUs: number; pixels: Uint8Array };

export function SpectrogramCanvas({ projectId, startUs, endUs, durationUs }: { projectId: string; startUs: number; endUs: number; durationUs: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const worker = useRef<Worker | null>(null);
  const cache = useRef(new Map<number, Tile>());
  const pending = useRef(new Set<number>());
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState('');
  const [width, setWidth] = useState(640);
  const visible = endUs > startUs && endUs - startUs <= 20_000_000;
  const firstTile = Math.floor(startUs / WINDOW_US) * WINDOW_US;
  const lastTile = Math.ceil(endUs / WINDOW_US) * WINDOW_US;

  useEffect(() => {
    cache.current.clear(); pending.current.clear();
    const processor = new Worker(new URL('./spectrogram.worker.ts', import.meta.url), { type: 'module' });
    worker.current = processor;
    processor.onmessage = (event: MessageEvent<{ id: number; pixels: Uint8Array }>) => {
      cache.current.set(event.data.id, { startUs: event.data.id, pixels: event.data.pixels });
      pending.current.delete(event.data.id);
      setRevision((value) => value + 1);
    };
    return () => { processor.terminate(); worker.current = null; };
  }, [projectId]);

  useEffect(() => {
    if (!visible) return;
    const controller = new AbortController();
    const requested: number[] = [];
    for (let first = firstTile; first < lastTile; first += WINDOW_US) {
      if (cache.current.has(first) || pending.current.has(first) || first >= durationUs) continue;
      const end = Math.min(first + WINDOW_US, durationUs);
      pending.current.add(first);
      requested.push(first);
      void studioApi.getPcmWindow(projectId, first, end, controller.signal).then(({ pcm, rate, channels }) => {
        worker.current?.postMessage({ id: first, pcm, rate, channels }, [pcm]);
      }).catch((cause) => {
        pending.current.delete(first);
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '声谱图片段加载失败');
      });
    }
    return () => {
      controller.abort();
      for (const first of requested) pending.current.delete(first);
    };
  }, [durationUs, firstTile, lastTile, projectId, visible]);

  useEffect(() => {
    const element = canvas.current;
    if (!element || !visible) return;
    const ratio = devicePixelRatio || 1;
    element.width = Math.max(1, Math.round(width * ratio));
    element.height = Math.round(72 * ratio);
    const context = element.getContext('2d');
    if (!context) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.fillStyle = '#101622'; context.fillRect(0, 0, width, 72);
    for (const tile of cache.current.values()) {
      if (tile.startUs + WINDOW_US < startUs || tile.startUs > endUs) continue;
      const image = context.createImageData(SPECTRUM_WIDTH, SPECTRUM_HEIGHT);
      for (let index = 0; index < tile.pixels.length; index++) {
        const value = tile.pixels[index] / 255;
        image.data[index * 4] = Math.round(24 + 225 * value);
        image.data[index * 4 + 1] = Math.round(35 + 145 * value * value);
        image.data[index * 4 + 2] = Math.round(75 + 110 * (1 - value));
        image.data[index * 4 + 3] = 255;
      }
      const offscreen = document.createElement('canvas'); offscreen.width = SPECTRUM_WIDTH; offscreen.height = SPECTRUM_HEIGHT;
      offscreen.getContext('2d')!.putImageData(image, 0, 0);
      const x = (tile.startUs - startUs) / (endUs - startUs) * width;
      context.drawImage(offscreen, x, 0, WINDOW_US / (endUs - startUs) * width, 72);
    }
  }, [endUs, revision, startUs, visible, width]);

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    observer.observe(element);
    return () => observer.disconnect();
  }, [visible]);

  if (!visible) return <p className={styles.spectrumHint}>放大到 20 秒以内显示声谱图</p>;
  return <div className={styles.spectrogram}><canvas ref={canvas} aria-label="声谱图" />{error && <small role="alert">{error}</small>}</div>;
}
