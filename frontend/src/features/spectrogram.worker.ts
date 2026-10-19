import { computeSpectrogram, type SpectrumWindow } from '../domain/spectrogram';

self.onmessage = (event: MessageEvent<{ id: number; token: number; pcm: ArrayBuffer; rate: number; channels: number; window: SpectrumWindow; diagnostics: boolean }>) => {
  const { id, token, pcm, rate, channels, window, diagnostics } = event.data;
  try {
    const began = diagnostics ? performance.now() : 0;
    const pixels = computeSpectrogram(new Int16Array(pcm), rate, channels, window);
    self.postMessage({ id, token, pixels, ...(diagnostics ? { computeMs: performance.now() - began } : {}) }, { transfer: [pixels.buffer] });
  } catch (error) {
    self.postMessage({ id, token, error: error instanceof Error ? error.message : '声谱图计算失败' });
  }
};
