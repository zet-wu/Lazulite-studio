import { afterEach, beforeEach, expect, it, vi } from 'vitest';
let browserStore: typeof import('./db').browserStore;
let computeWaveformWindow: typeof import('./media').computeWaveformWindow, getAudioObjectUrl: typeof import('./media').getAudioObjectUrl, pcmWindow: typeof import('./media').pcmWindow, prepareProjectMedia: typeof import('./media').prepareProjectMedia, releaseProjectMedia: typeof import('./media').releaseProjectMedia, retainBrowserMedia: typeof import('./media').retainBrowserMedia, waveformPeaks: typeof import('./media').waveformPeaks;

vi.mock('./db', () => ({ browserStore: { audio: vi.fn() } }));
const buffer = (data: number[][], rate = 1000): AudioBuffer => ({
  duration: data[0].length / rate, length: data[0].length, sampleRate: rate, numberOfChannels: data.length,
  getChannelData: (channel: number) => Float32Array.from(data[channel]),
} as AudioBuffer);
const decoded = buffer([[-1, 0, 1, 0.5]]);
beforeEach(async () => {
  vi.resetModules();
  ({ browserStore } = await import('./db'));
  ({ computeWaveformWindow, getAudioObjectUrl, pcmWindow, prepareProjectMedia, releaseProjectMedia, retainBrowserMedia, waveformPeaks } = await import('./media'));
  vi.stubGlobal('URL', { createObjectURL: vi.fn().mockReturnValueOnce('blob:first').mockReturnValue('blob:next'), revokeObjectURL: vi.fn() });
  vi.stubGlobal('AudioContext', class {
    state = 'running';
    decodeAudioData = vi.fn(async () => decoded);
    close = vi.fn(async () => { this.state = 'closed'; });
  });
  vi.mocked(browserStore.audio).mockResolvedValue({ arrayBuffer: async () => new ArrayBuffer(8) } as Blob);
});
afterEach(() => { releaseProjectMedia(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('preserves stereo extrema, partial tail buckets and coarser waveform levels', () => {
  const data = buffer([Array(25).fill(0.25), [...Array(20).fill(-0.5), ...Array(5).fill(-1)]]);
  expect(waveformPeaks(data, 0)).toEqual({ minimum: [-0.5, -0.5, -1], maximum: [0.25, 0.25, 0.25] });
  expect(waveformPeaks(data, 1)).toEqual({ minimum: [-0.5, -1], maximum: [0.25, 0.25] });
});

it('slices integer sample windows, interleaves stereo and clamps signed 16-bit samples', () => {
  const data = buffer([[-2, -0.5, 0, 0.5, 2], [2, 0.5, 0, -0.5, -2]]);
  const window = pcmWindow(data, -1, 10);
  expect({ rate: window.rate, channels: window.channels }).toEqual({ rate: 1000, channels: 2 });
  expect([...new Int16Array(window.pcm)]).toEqual([-32768, 32767, -16384, 16384, 0, 0, 16384, -16384, 32767, -32768]);
  expect([...new Int16Array(pcmWindow(data, 1, 3).pcm)]).toEqual([-16384, 16384, 0, 0]);
  expect(pcmWindow(data, 20, 30).pcm.byteLength).toBe(0);
});

it('reuses the active URL, releases on source and project changes, and supports missing session audio', async () => {
  await prepareProjectMedia('p1', 'a1');
  await prepareProjectMedia('p1', 'a1');
  expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
  expect(getAudioObjectUrl('p1', 'a1')).toBe('blob:first');
  expect(await computeWaveformWindow('p1', 100, 200, 0)).toMatchObject({ minimum: [], maximum: [], start_ms: 4, end_ms: 4 });
  await prepareProjectMedia('p1', 'a2');
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:first');
  await prepareProjectMedia('p2', null);
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:next');
  expect(getAudioObjectUrl('p1')).toBeUndefined();
  vi.mocked(browserStore.audio).mockResolvedValueOnce(undefined);
  await prepareProjectMedia('p3', 'missing');
  expect(getAudioObjectUrl('p3')).toBeUndefined();
});

it('disposes after unmount while preserving StrictMode effect replay', async () => {
  vi.useFakeTimers();
  await prepareProjectMedia('p1', 'a1');
  retainBrowserMedia('p1')();
  const leave = retainBrowserMedia('p1');
  vi.runAllTimers();
  expect(getAudioObjectUrl('p1')).toBe('blob:first');
  leave(); vi.runAllTimers();
  expect(getAudioObjectUrl('p1')).toBeUndefined();
});

it('discards an in-flight decode when another project becomes active', async () => {
  let complete!: (value: ArrayBuffer) => void;
  vi.mocked(browserStore.audio).mockResolvedValueOnce({ arrayBuffer: () => new Promise<ArrayBuffer>(resolve => { complete = resolve; }) } as Blob);
  const loading = prepareProjectMedia('p1', 'slow');
  await vi.waitFor(() => expect(complete).toBeTypeOf('function'));
  await prepareProjectMedia('p2', 'next');
  complete(new ArrayBuffer(8)); await loading;
  expect(getAudioObjectUrl('p1')).toBeUndefined();
  expect(getAudioObjectUrl('p2')).toBe('blob:first');
  expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
});
