export const SPECTRUM_WIDTH = 96;
export const SPECTRUM_HEIGHT = 48;
const SIZE = 512;

function fft(real: Float32Array, imaginary: Float32Array) {
  for (let index = 1, reversed = 0; index < SIZE; index++) {
    let bit = SIZE >> 1;
    for (; reversed & bit; bit >>= 1) reversed ^= bit;
    reversed ^= bit;
    if (index < reversed) {
      [real[index], real[reversed]] = [real[reversed], real[index]];
      [imaginary[index], imaginary[reversed]] = [imaginary[reversed], imaginary[index]];
    }
  }
  for (let length = 2; length <= SIZE; length <<= 1) {
    const angle = -2 * Math.PI / length;
    for (let block = 0; block < SIZE; block += length) for (let index = 0; index < length / 2; index++) {
      const cosine = Math.cos(angle * index), sine = Math.sin(angle * index);
      const even = block + index, odd = even + length / 2;
      const r = cosine * real[odd] - sine * imaginary[odd];
      const i = sine * real[odd] + cosine * imaginary[odd];
      real[odd] = real[even] - r; imaginary[odd] = imaginary[even] - i;
      real[even] += r; imaginary[even] += i;
    }
  }
}

/** Returns logarithmic frequency bins, low frequencies at the bottom. */
export function computeSpectrogram(pcm: Int16Array, rate: number, channels: number): Uint8Array {
  if (!Number.isSafeInteger(rate) || rate < 1000 || !Number.isSafeInteger(channels) || channels < 1 || channels > 8) throw new Error('Invalid PCM format');
  const frames = Math.floor(pcm.length / channels);
  const output = new Uint8Array(SPECTRUM_WIDTH * SPECTRUM_HEIGHT);
  if (frames < SIZE) return output;
  const real = new Float32Array(SIZE), imaginary = new Float32Array(SIZE);
  const high = Math.min(8000, rate / 2);
  for (let column = 0; column < SPECTRUM_WIDTH; column++) {
    const center = Math.round((column + 0.5) / SPECTRUM_WIDTH * frames);
    for (let index = 0; index < SIZE; index++) {
      const frame = Math.max(0, Math.min(frames - 1, center + index - SIZE / 2));
      let sample = 0;
      for (let channel = 0; channel < channels; channel++) sample += pcm[frame * channels + channel] / 32768;
      real[index] = sample / channels * (0.5 - 0.5 * Math.cos(2 * Math.PI * index / (SIZE - 1)));
      imaginary[index] = 0;
    }
    fft(real, imaginary);
    for (let row = 0; row < SPECTRUM_HEIGHT; row++) {
      const frequency = 80 * (high / 80) ** (row / (SPECTRUM_HEIGHT - 1));
      const bin = Math.min(SIZE / 2, Math.round(frequency * SIZE / rate));
      const amplitude = Math.hypot(real[bin], imaginary[bin]) / SIZE * 4;
      const db = 20 * Math.log10(Math.max(1e-6, amplitude));
      output[(SPECTRUM_HEIGHT - row - 1) * SPECTRUM_WIDTH + column] = Math.max(0, Math.min(255, Math.round((db + 70) / 70 * 255)));
    }
  }
  return output;
}
