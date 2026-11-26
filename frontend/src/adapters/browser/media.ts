import { message, MessageError } from '../../domain/messages';
import type { Asset, WaveformWindow } from '../http/client';
import { browserStore, stageAudio, type BrowserAsset } from './db';

type ActiveMedia = { projectId: string; assetId: string; buffer: AudioBuffer; url: string; peaks: Map<number, { minimum: number[]; maximum: number[] }> };
let active: ActiveMedia | undefined;
let pending: { key: string; promise: Promise<void> } | undefined;
let generation = 0;
let releaseTimer: ReturnType<typeof setTimeout> | undefined;

export async function decodeLocalAudio(blob: Blob, signal?: AbortSignal): Promise<AudioBuffer> {
  signal?.throwIfAborted();
  const context = new AudioContext();
  let rejectAbort: ((reason: unknown) => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => { rejectAbort = reject; });
  const cancel = () => rejectAbort?.(signal?.reason);
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    const decoding = (async () => {
      const bytes = await blob.arrayBuffer();
      signal?.throwIfAborted();
      return context.decodeAudioData(bytes);
    })();
    const buffer = await Promise.race([decoding, aborted]);
    signal?.throwIfAborted();
    return buffer;
  } catch {
    signal?.throwIfAborted();
    throw new MessageError(message('demo.decodeFailed'));
  } finally {
    signal?.removeEventListener('abort', cancel);
    if (context.state !== 'closed') await context.close();
  }
}

export async function uploadLocalAudio(file: File, progress: (value: number) => void, signal?: AbortSignal): Promise<Asset> {
  progress(0);
  const buffer = await decodeLocalAudio(file, signal);
  progress(1);
  const id = crypto.randomUUID();
  const duration = Math.round(buffer.duration * 1000);
  const asset: BrowserAsset = { schema_version: 'studio-asset-v1', id, filename: file.name, content_type: file.type || 'application/octet-stream', size_bytes: file.size,
    duration_ms: duration, source_duration_ms: duration, source_start_ms: 0, proxy_offset_ms: 0, asset_hash: id, status: 'ready',
    project_id: null, sample_rate: buffer.sampleRate, channels: buffer.numberOfChannels, ephemeral: false };
  signal?.throwIfAborted();
  await stageAudio(asset, file);
  if (signal?.aborted) { await browserStore.discard(id); signal.throwIfAborted(); }
  asset.ephemeral = (await browserStore.asset(id))!.ephemeral;
  return asset;
}

export function releaseProjectMedia(projectId?: string) {
  if (projectId && active?.projectId !== projectId && !pending?.key.startsWith(`${projectId}:`)) return;
  generation++;
  pending = undefined;
  if (active) URL.revokeObjectURL(active.url);
  active = undefined;
}

export async function prepareProjectMedia(projectId: string, assetId: string | null): Promise<void> {
  clearTimeout(releaseTimer);
  if (active?.projectId === projectId && active.assetId === assetId) return;
  const key = `${projectId}:${assetId}`;
  if (pending?.key === key) return pending.promise;
  releaseProjectMedia();
  if (!assetId) return;
  const token = generation;
  const promise = (async () => {
    const blob = await browserStore.audio(assetId);
    if (!blob || token !== generation) return;
    const buffer = await decodeLocalAudio(blob);
    if (token !== generation) return;
    active = { projectId, assetId, buffer, url: URL.createObjectURL(blob), peaks: new Map() };
  })();
  pending = { key, promise };
  try { await promise; } finally { if (pending?.promise === promise) pending = undefined; }
}

/** Defer disposal one turn so React StrictMode's effect replay can retain it. */
export function retainBrowserMedia(projectId: string) {
  clearTimeout(releaseTimer);
  return () => { releaseTimer = setTimeout(() => releaseProjectMedia(projectId), 0); };
}
export const getAudioObjectUrl = (projectId: string, assetId?: string) => active?.projectId === projectId && (!assetId || assetId === active.assetId) ? active.url : undefined;
export const audioSampleRate = (projectId: string) => active?.projectId === projectId ? active.buffer.sampleRate : undefined;
export const isEphemeralAsset = (asset: Asset | null) => !!asset && 'ephemeral' in asset && asset.ephemeral === true;
function currentMedia(projectId: string): ActiveMedia {
  if (active?.projectId !== projectId) throw new MessageError(message('demo.audioMissing'));
  return active;
}

export function waveformPeaks(buffer: AudioBuffer, level: number) {
  const bucketMs = 10 * 2 ** level;
  const count = Math.ceil(buffer.duration * 1000 / bucketMs);
  const minimum = new Array<number>(count), maximum = new Array<number>(count);
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, channel) => buffer.getChannelData(channel));
  for (let bucket = 0; bucket < count; bucket++) {
    const first = Math.round(bucket * bucketMs * buffer.sampleRate / 1000);
    const last = Math.min(buffer.length, Math.round((bucket + 1) * bucketMs * buffer.sampleRate / 1000));
    let min = 1, max = -1;
    for (const channel of channels) for (let sample = first; sample < last; sample++) {
      min = Math.min(min, channel[sample]); max = Math.max(max, channel[sample]);
    }
    minimum[bucket] = last > first ? min : 0;
    maximum[bucket] = last > first ? max : 0;
  }
  return { minimum, maximum };
}

export async function computeWaveformWindow(projectId: string, startMs = 0, endMs?: number, level = 8, signal?: AbortSignal): Promise<WaveformWindow> {
  signal?.throwIfAborted();
  const media = currentMedia(projectId), bucketMs = 10 * 2 ** level;
  let peaks = media.peaks.get(level);
  if (!peaks) {
    peaks = waveformPeaks(media.buffer, level);
    // Keep at most three resolutions for the single active project.
    if (media.peaks.size >= 3) media.peaks.delete(media.peaks.keys().next().value!);
    media.peaks.set(level, peaks);
  }
  const first = Math.min(peaks.minimum.length, Math.max(0, Math.floor(startMs / bucketMs)));
  const last = Math.max(first, Math.min(peaks.minimum.length, Math.ceil((endMs ?? media.buffer.duration * 1000) / bucketMs)));
  return { schema_version: 'studio-waveform-v1', asset_id: media.assetId, asset_hash: media.assetId, version: 'browser-v1', level,
    start_ms: Math.min(Math.round(media.buffer.duration * 1000), first * bucketMs), end_ms: Math.min(Math.round(media.buffer.duration * 1000), last * bucketMs), bucket_ms: bucketMs,
    minimum: peaks.minimum.slice(first, last), maximum: peaks.maximum.slice(first, last) };
}

export function pcmWindow(buffer: AudioBuffer, startMs: number, endMs: number) {
  const first = Math.min(buffer.length, Math.max(0, Math.round(startMs * buffer.sampleRate / 1000)));
  const last = Math.min(buffer.length, Math.max(first, Math.round(endMs * buffer.sampleRate / 1000)));
  const channels = buffer.numberOfChannels, pcm = new Int16Array((last - first) * channels);
  for (let channel = 0; channel < channels; channel++) {
    const data = buffer.getChannelData(channel);
    for (let frame = first; frame < last; frame++) {
      const value = Math.max(-1, Math.min(1, data[frame]));
      pcm[(frame - first) * channels + channel] = Math.round(value * (value < 0 ? 32768 : 32767));
    }
  }
  return { pcm: pcm.buffer, rate: buffer.sampleRate, channels };
}
export async function slicePcmWindow(projectId: string, startMs: number, endMs: number, signal?: AbortSignal) {
  signal?.throwIfAborted();
  return pcmWindow(currentMedia(projectId).buffer, startMs, endMs);
}
