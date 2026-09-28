import { useEffect, useRef, useState } from 'react';
import { studioApi } from '../adapters/http/client';
import { SPECTRUM_HEIGHT, SPECTRUM_WIDTH, SPECTRUM_WINDOW_US, spectrumWindow } from '../domain/spectrogram';
import { useCanvasMetrics } from './useCanvasMetrics';
import { SpectrumCache } from './spectrum-cache';
import styles from './media.module.css';

type Props = { projectId: string; assetIdentity: string; startUs: number; endUs: number; durationUs: number };
type Request = { token: number; controller: AbortController; began: number };
type Result = { id: number; token: number; pixels: Uint8Array; computeMs: number; error?: string };

export function SpectrogramCanvas(props: Props) {
  return <AssetSpectrum key={`${props.projectId}:${props.assetIdentity}:${props.durationUs}:fft512-${SPECTRUM_WIDTH}x${SPECTRUM_HEIGHT}`} {...props} />;
}

function AssetSpectrum({ projectId, startUs, endUs, durationUs }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const worker = useRef<Worker | null>(null);
  const cache = useRef(new SpectrumCache());
  const pending = useRef(new Map<number, Request>());
  const failed = useRef(new Map<number, string>());
  const wanted = useRef<number[]>([]);
  const nextToken = useRef(0);
  const pump = useRef<() => void>(() => {});
  const stats = useRef({ completed: 0, computeMs: [] as number[], requestMs: [] as number[] });
  const [revision, setRevision] = useState(0);
  const [retry, setRetry] = useState(0);
  const [error, setError] = useState('');
  const visible = endUs > startUs && endUs - startUs <= 20_000_000;
  const firstTile = Math.floor(startUs / SPECTRUM_WINDOW_US) * SPECTRUM_WINDOW_US;
  const lastTile = Math.ceil(endUs / SPECTRUM_WINDOW_US) * SPECTRUM_WINDOW_US;
  const { width, ratio } = useCanvasMetrics(canvas, visible);
  const changed = () => setRevision(value => value + 1);

  pump.current = () => {
    const processor = worker.current;
    if (!processor) return;
    for (const first of wanted.current) {
      if (cache.current.get(first) || pending.current.has(first) || failed.current.has(first)) continue;
      if (pending.current.size >= 2) break;
      const request: Request = { token: ++nextToken.current, controller: new AbortController(), began: performance.now() };
      const window = spectrumWindow(first, Math.min(first + SPECTRUM_WINDOW_US, durationUs), durationUs);
      pending.current.set(first, request);
      void studioApi.getPcmWindow(projectId, window.requestStartUs, window.requestEndUs, request.controller.signal).then(({ pcm, rate, channels }) => {
        if (pending.current.get(first) !== request || !wanted.current.includes(first)) return;
        stats.current.requestMs = [...stats.current.requestMs.slice(-127), performance.now() - request.began];
        processor.postMessage({ id: first, token: request.token, pcm, rate, channels, window }, [pcm]);
      }).catch(cause => {
        if (pending.current.get(first) !== request) return;
        pending.current.delete(first);
        if (!request.controller.signal.aborted) {
          failed.current.set(first, cause instanceof Error ? cause.message : '声谱图片段加载失败');
        }
        changed(); pump.current();
      });
    }
  };

  useEffect(() => {
    const processor = new Worker(new URL('./spectrogram.worker.ts', import.meta.url), { type: 'module' });
    worker.current = processor;
    processor.onmessage = (event: MessageEvent<Result>) => {
      const result = event.data, request = pending.current.get(result.id);
      if (!request || request.token !== result.token || !wanted.current.includes(result.id)) return;
      pending.current.delete(result.id);
      if (result.error) { failed.current.set(result.id, result.error); }
      else {
        cache.current.set({ startUs: result.id, endUs: Math.min(result.id + SPECTRUM_WINDOW_US, durationUs), pixels: result.pixels });
        stats.current.completed++;
        stats.current.computeMs = [...stats.current.computeMs.slice(-127), result.computeMs];
      }
      changed(); pump.current();
    };
    processor.onerror = event => {
      for (const [id, request] of pending.current) { request.controller.abort(); failed.current.set(id, event.message); }
      pending.current.clear(); worker.current = null; processor.terminate();
      setError(`声谱图计算失败：${event.message}`); changed();
    };
    pump.current();
    return () => {
      worker.current = null; processor.onmessage = null; processor.onerror = null; processor.terminate();
      for (const request of pending.current.values()) request.controller.abort();
      pending.current.clear();
    };
  }, [durationUs, retry]);

  useEffect(() => {
    wanted.current = visible ? Array.from({ length: Math.max(0, (lastTile - firstTile) / SPECTRUM_WINDOW_US) }, (_, index) => firstTile + index * SPECTRUM_WINDOW_US).filter(first => first < durationUs) : [];
    for (const [first, request] of pending.current) if (!wanted.current.includes(first)) { request.controller.abort(); pending.current.delete(first); }
    pump.current(); changed();
  }, [durationUs, firstTile, lastTile, visible, retry]);

  useEffect(() => {
    const element = canvas.current;
    if (!element || !visible) return;
    element.width = Math.max(1, Math.round(width * ratio)); element.height = Math.round(72 * ratio);
    const context = element.getContext('2d')!;
    context.fillStyle = '#101622'; context.fillRect(0, 0, element.width, element.height);
    const x = (time: number) => Math.round((time - startUs) / (endUs - startUs) * element.width);
    for (const first of wanted.current) {
      const last = Math.min(first + SPECTRUM_WINDOW_US, durationUs), left = x(first), right = x(last);
      const tile = cache.current.get(first);
      if (!tile) {
        context.fillStyle = failed.current.has(first) ? '#502933' : '#24354b';
        context.fillRect(left, 0, right - left, element.height);
        continue;
      }
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
      context.drawImage(offscreen, left, 0, right - left, element.height);
    }
  }, [endUs, revision, startUs, visible, width, ratio]);

  if (!visible) return <p className={styles.spectrumHint}>放大到 20 秒以内显示声谱图</p>;
  const displayError = error || wanted.current.map(first => failed.current.get(first)).find(Boolean);
  const ready = wanted.current.filter(first => cache.current.get(first)).length;
  return <div className={styles.spectrogram} data-spectrum-ready={ready} data-spectrum-wanted={wanted.current.length}
    data-spectrum-stats={JSON.stringify({ ...stats.current, cacheSize: cache.current.size, evictions: cache.current.evictions, pending: pending.current.size })}>
    <canvas ref={canvas} aria-label="声谱图" />
    {ready < wanted.current.length && !displayError && <small role="status">声谱图加载中…</small>}
    {displayError && <small role="alert">{displayError} <button onClick={() => { failed.current.clear(); setError(''); setRetry(value => value + 1); }}>重试声谱图</button></small>}
  </div>;
}
