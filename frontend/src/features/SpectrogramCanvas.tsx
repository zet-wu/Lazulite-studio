import { useContext } from 'react';
import { TimelineContent } from './TimelineContent';
import { useSpectrumHeight } from '../adapters/timeline-preferences';
import { useMessageText } from '../shared/useMessageText';
import { message as describeMessage, errorMessage, type Message } from '../domain/messages';
import { i18n, formatMessage } from '../i18n';
import { useTranslation } from 'react-i18next';
import { spectrumDiagnosticsEnabled } from './spectrum-diagnostics';
import { IconButton } from '../shared/Controls';
import { TimelineIndicators, TimelineIndicatorContext } from './TimelineIndicators';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { studioApi } from '../adapters/http/client';
import { FFT_SIZE, SPECTRUM_HEIGHT, SPECTRUM_WIDTH, SPECTRUM_WINDOW_MS, PROXY_SAMPLE_RATE, spectrumWindow } from '../domain/spectrogram';
import { useCanvasMetrics } from './useCanvasMetrics';
import { SpectrumCache } from './spectrum-cache';
import styles from './media.module.css';
import { spectrumPalette } from './spectrum-palette';

type Props = { pcmRate?: number; vocal?: string | null; projectId: string; assetIdentity: string; startMs: number; endMs: number; durationMs: number };
type Request = { token: number; controller: AbortController; began?: number; posted: boolean };
type Result = { id: number; token: number; pixels: Uint8Array; computeMs?: number; error?: Message };

function colorizeTile(pixels: Uint8Array): HTMLCanvasElement | undefined {
  const offscreen = document.createElement('canvas');
  offscreen.width = SPECTRUM_WIDTH;
  offscreen.height = SPECTRUM_HEIGHT;
  const ctx = offscreen.getContext('2d');
  if (!ctx) return undefined;
  const image = ctx.createImageData(SPECTRUM_WIDTH, SPECTRUM_HEIGHT);
  for (let index = 0; index < pixels.length; index++) {
    const color = spectrumPalette[pixels[index]];
    image.data[index * 4] = color[0];
    image.data[index * 4 + 1] = color[1];
    image.data[index * 4 + 2] = color[2];
    image.data[index * 4 + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  return offscreen;
}

export function SpectrogramCanvas(props: Props) {
  useTranslation();
  return <AssetSpectrum key={`${props.projectId}:${props.assetIdentity}:${props.durationMs}:${props.pcmRate ?? PROXY_SAMPLE_RATE}:fft${FFT_SIZE}-${SPECTRUM_WIDTH}x${SPECTRUM_HEIGHT}`} {...props} />;
}

function AssetSpectrum({ pcmRate = PROXY_SAMPLE_RATE, vocal, projectId, startMs, endMs, durationMs }: Props) {
  useTranslation();
  const {paddingMs = 0} = useContext(TimelineIndicatorContext);
  const drawStart = startMs-paddingMs, drawEnd = endMs+paddingMs;
  const [displayHeight] = useSpectrumHeight();
  const canvas = useRef<HTMLCanvasElement>(null);
  const worker = useRef<Worker | null>(null);
  const [diagnostics] = useState(spectrumDiagnosticsEnabled);
  const cache = useRef(new SpectrumCache(diagnostics));
  const stripCanvas = useRef<HTMLCanvasElement | null>(null);
  const pending = useRef(new Map<number, Request>());
  const failed = useRef(new Map<number, Message>());
  const wanted = useRef<number[]>([]);
  const nextToken = useRef(0);
  const pump = useRef<() => void>(() => {});
  const stats = useRef(diagnostics ? { completed: 0, computeMs: [] as number[], requestMs: [] as number[] } : null);
  const [revision, setRevision] = useState(0);
  const [retry, setRetry] = useState(0);
  const [error, setError] = useMessageText('');
  const visible = endMs > startMs && endMs - startMs <= 20_000;
  const firstTile = Math.floor(Math.max(0,drawStart) / SPECTRUM_WINDOW_MS) * SPECTRUM_WINDOW_MS;
  const lastTile = Math.ceil(Math.min(durationMs,drawEnd) / SPECTRUM_WINDOW_MS) * SPECTRUM_WINDOW_MS;
  const { width, ratio, observe: observeCanvas } = useCanvasMetrics(canvas, visible);
  const changed = () => setRevision(value => value + 1);

  pump.current = () => {
    const processor = worker.current;
    if (!processor) return;
    for (const first of wanted.current) {
      if (cache.current.get(first) || pending.current.has(first) || failed.current.has(first)) continue;
      if (pending.current.size >= 2) break;
      const request: Request = { token: ++nextToken.current, controller: new AbortController(), began: diagnostics ? performance.now() : undefined, posted: false };
      const window = spectrumWindow(first, Math.min(first + SPECTRUM_WINDOW_MS, durationMs), durationMs, pcmRate);
      pending.current.set(first, request);
      void studioApi.getPcmWindow(projectId, window.requestStartMs, window.requestEndMs, request.controller.signal, vocal).then(({ pcm, rate, channels }) => {
        if (pending.current.get(first) !== request || !wanted.current.includes(first)) return;
        if (stats.current) stats.current.requestMs = [...stats.current.requestMs.slice(-127), performance.now() - request.began!];
        request.posted = true;
        processor.postMessage({ id: first, token: request.token, pcm, rate, channels, window, diagnostics }, [pcm]);
      }).catch(cause => {
        if (pending.current.get(first) !== request) return;
        pending.current.delete(first);
        if (!request.controller.signal.aborted) {
          failed.current.set(first, errorMessage(cause));
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
        const bitmap = colorizeTile(result.pixels);
        cache.current.set({
          startMs: result.id,
          endMs: Math.min(result.id + SPECTRUM_WINDOW_MS, durationMs),
          pixels: bitmap ? undefined : result.pixels,
          bitmap,
        });
        if (stats.current) {
          stats.current.completed++;
          stats.current.computeMs = [...stats.current.computeMs.slice(-127), result.computeMs!];
        }
      }
      changed(); pump.current();
    };
    processor.onerror = event => {
      for (const [id, request] of pending.current) { request.controller.abort(); failed.current.set(id, describeMessage('spectrum.computeFailed',{diagnostic:event.message})); }
      pending.current.clear(); worker.current = null; processor.terminate();
      setError(describeMessage('spectrum.computeFailed',{diagnostic:event.message})); changed();
    };
    pump.current();
    return () => {
      worker.current = null; processor.onmessage = null; processor.onerror = null; processor.terminate();
      for (const request of pending.current.values()) request.controller.abort();
      pending.current.clear();
    };
  }, [durationMs, retry]);

  useEffect(() => {
    const nextWanted = visible ? Array.from({ length: Math.max(0, (lastTile - firstTile) / SPECTRUM_WINDOW_MS) }, (_, index) => firstTile + index * SPECTRUM_WINDOW_MS).filter(first => first < durationMs) : [];
    wanted.current = nextWanted;
    const wantedSet = new Set(nextWanted);
    for (const first of failed.current.keys()) if (!wantedSet.has(first)) failed.current.delete(first);
    for (const [first, request] of pending.current) {
      if (!wantedSet.has(first)) {
        request.controller.abort();
        pending.current.delete(first);
      }
    }
    pump.current();
    changed();
  }, [durationMs, firstTile, lastTile, visible, retry]);

  useEffect(() => () => {
    cache.current.clear();
    if (stripCanvas.current) { stripCanvas.current.width = 0; stripCanvas.current.height = 0; stripCanvas.current = null; }
  }, []);

  // Match the new content origin in the same paint as the translated layers.
  useLayoutEffect(() => {
    const element = canvas.current;
    if (!element || !visible) return;
    const pixelWidth = Math.max(1, Math.round(width * ratio));
    const pixelHeight = Math.max(1, Math.round(displayHeight * ratio));
    if (element.width !== pixelWidth) element.width = pixelWidth;
    if (element.height !== pixelHeight) element.height = pixelHeight;
    const context = element.getContext('2d');
    if (!context) return;
    context.fillStyle = '#101622'; context.fillRect(0, 0, element.width, element.height);
    const x = (time: number) => (time - drawStart) / (drawEnd - drawStart) * element.width;
    const runs: { startMs: number; endMs: number; bitmaps: HTMLCanvasElement[] }[] = [];
    let run: typeof runs[number] | null = null;
    for (const first of wanted.current) {
      const last = Math.min(first + SPECTRUM_WINDOW_MS, durationMs);
      const tile = cache.current.get(first);
      if (tile && !tile.bitmap && tile.pixels) {
        tile.bitmap = colorizeTile(tile.pixels);
        if (tile.bitmap) tile.pixels = undefined;
      }
      if (!tile?.bitmap) {
        run = null;
        const left = Math.round(x(first)), right = Math.round(x(last));
        context.fillStyle = failed.current.has(first) ? '#502933' : '#24354b';
        if (right > left) context.fillRect(left, 0, right - left, element.height);
        continue;
      }
      if (!run || run.endMs !== first) {
        run = { startMs: first, endMs: last, bitmaps: [] }; runs.push(run);
      }
      run.endMs = last; run.bitmaps.push(tile.bitmap);
    }
    if (!runs.length) return;
    const strip = stripCanvas.current ??= document.createElement('canvas');
    const stripWidth = Math.max(...runs.map(run => run.bitmaps.length)) * SPECTRUM_WIDTH;
    if (strip.width !== stripWidth) strip.width = stripWidth;
    if (strip.height !== SPECTRUM_HEIGHT) strip.height = SPECTRUM_HEIGHT;
    const stripContext = strip.getContext('2d')!;
    for (const run of runs) {
      const left = Math.round(x(run.startMs)), right = Math.round(x(run.endMs));
      if (right <= left) continue;
      stripContext.clearRect(0, 0, strip.width, strip.height);
      run.bitmaps.forEach((bitmap, index) => stripContext.drawImage(bitmap, index * SPECTRUM_WIDTH, 0));
      // Scale a continuous source once so interpolation crosses internal tile edges.
      const sourceWidth = (run.endMs - run.startMs) / SPECTRUM_WINDOW_MS * SPECTRUM_WIDTH;
      context.drawImage(strip, 0, 0, sourceWidth, SPECTRUM_HEIGHT, left, 0, right - left, element.height);
    }
  }, [drawEnd, revision, drawStart, visible, width, ratio, displayHeight, durationMs]);

  if (!visible) return <p data-wheel-zoom className={styles.spectrumHint}>{t('spectrum.zoomHint')}</p>;
  const displayError = error || wanted.current.map(first => failed.current.get(first)).filter(Boolean).map(value=>formatMessage(value!))[0];
  const ready = wanted.current.filter(first => cache.current.get(first)).length;
  return <div className={styles.spectrogram} data-spectrum-ready={ready} data-spectrum-wanted={wanted.current.length}
    data-spectrum-stats={stats.current ? JSON.stringify({ ...stats.current, cacheSize: cache.current.size, evictions: cache.current.evictions, pending: pending.current.size }) : undefined}>
    <div data-wheel-zoom className={styles.spectrumPlot} data-timeline-pan="seek" tabIndex={-1} style={{height:displayHeight}}><TimelineContent><canvas style={paddingMs?{width:"150%",marginLeft:"-25%"}:undefined} ref={observeCanvas} aria-label={t('spectrum.title')} /></TimelineContent><TimelineIndicators playback /></div>
    {ready < wanted.current.length && !displayError && <small role="status">{t('spectrum.loading')}</small>}
    {displayError && <small role="alert">{displayError} <IconButton icon="refresh" label={t('spectrum.retry')} data-role="secondary" onClick={() => { failed.current.clear(); setError(''); setRetry(value => value + 1); }}/></small>}
  </div>;
}

const t=i18n.t.bind(i18n);
