import { computeSpectrogram, SPECTRUM_HEIGHT, SPECTRUM_WIDTH } from '../domain/spectrogram';

self.onmessage = (event: MessageEvent<{ id: number; pcm: ArrayBuffer; rate: number; channels: number }>) => {
  const { id, pcm, rate, channels } = event.data;
  const pixels = computeSpectrogram(new Int16Array(pcm), rate, channels);
  self.postMessage({ id, pixels, width: SPECTRUM_WIDTH, height: SPECTRUM_HEIGHT }, { transfer: [pixels.buffer] });
};
