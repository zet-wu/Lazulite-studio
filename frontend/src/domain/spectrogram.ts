import { message, MessageError } from './messages';
export const SPECTRUM_WIDTH = 384;
export const SPECTRUM_HEIGHT = 256;
export const FFT_SIZE = 1024;
const SIZE = FFT_SIZE;
export const SPECTRUM_WINDOW_MS = 4_000;
export const PROXY_SAMPLE_RATE = 48_000;
export type SpectrumWindow = { coreStartMs: number; coreEndMs: number; requestStartMs: number; requestEndMs: number; durationMs: number };

const BIT_REVERSAL = new Uint16Array(SIZE);
const COS_TABLE = new Float32Array(SIZE >> 1);
const SIN_TABLE = new Float32Array(SIZE >> 1);
const HANN_WINDOW = new Float32Array(SIZE);
for (let index = 0; index < SIZE; index++) {
  let reversed = 0;
  let value = index;
  for (let bit = 1; bit < SIZE; bit <<= 1) {
    reversed = (reversed << 1) | (value & 1);
    value >>= 1;
  }
  BIT_REVERSAL[index] = reversed;
  HANN_WINDOW[index] = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / (SIZE - 1));
}
for (let index = 0; index < SIZE >> 1; index++) {
  const angle = (-2 * Math.PI * index) / SIZE;
  COS_TABLE[index] = Math.cos(angle);
  SIN_TABLE[index] = Math.sin(angle);
}

const BIN_MAPS = new Map<number, Float32Array>();
function binMapForRate(rate: number): Float32Array {
  let bins = BIN_MAPS.get(rate);
  if (bins) return bins;
  bins = new Float32Array(SPECTRUM_HEIGHT);
  const high = Math.min(8000, rate / 2);
  const ratio = high / 80;
  for (let row = 0; row < SPECTRUM_HEIGHT; row++) {
    const frequency = 80 * ratio ** (row / (SPECTRUM_HEIGHT - 1));
    bins[row] = Math.min(SIZE >> 1, (frequency * SIZE) / rate);
  }
  BIN_MAPS.set(rate, bins);
  return bins;
}

// Requests enclose the FFT context on integer milliseconds; samples remain frames.
export const sampleTimestamp = (frame: number, rate = PROXY_SAMPLE_RATE) => Math.floor(frame * 1000 / rate);
export function spectrumWindow(coreStartMs: number, coreEndMs: number, durationMs: number, rate = PROXY_SAMPLE_RATE): SpectrumWindow {
  const first = Math.round(coreStartMs * rate / 1e3);
  const last = Math.round(coreEndMs * rate / 1e3);
  return { coreStartMs, coreEndMs, durationMs,
    requestStartMs: sampleTimestamp(Math.max(0, first - SIZE / 2), rate),
    requestEndMs: Math.min(durationMs, Math.ceil((last + SIZE / 2) * 1000 / rate)),
  };
}

function fft(real: Float32Array, imaginary: Float32Array) {
  for (let index = 1; index < SIZE; index++) {
    const reversed = BIT_REVERSAL[index];
    if (index < reversed) {
      const tmpReal = real[index];
      real[index] = real[reversed];
      real[reversed] = tmpReal;
      const tmpImag = imaginary[index];
      imaginary[index] = imaginary[reversed];
      imaginary[reversed] = tmpImag;
    }
  }
  for (let length = 2; length <= SIZE; length <<= 1) {
    const half = length >> 1;
    const step = SIZE / length;
    for (let block = 0; block < SIZE; block += length) {
      for (let index = 0; index < half; index++) {
        const twiddle = index * step;
        const cosine = COS_TABLE[twiddle];
        const sine = SIN_TABLE[twiddle];
        const even = block + index;
        const odd = even + half;
        const r = cosine * real[odd] - sine * imaginary[odd];
        const i = sine * real[odd] + cosine * imaginary[odd];
        real[odd] = real[even] - r;
        imaginary[odd] = imaginary[even] - i;
        real[even] += r;
        imaginary[even] += i;
      }
    }
  }
}

/** Returns logarithmic frequency bins, low frequencies at the bottom. */
export function computeSpectrogram(pcm: Int16Array, rate: number, channels: number, window?: SpectrumWindow): Uint8Array {
  if (!Number.isSafeInteger(rate) || rate < 1000 || !Number.isSafeInteger(channels) || channels < 1 || channels > 8) throw new MessageError(message('spectrum.pcmInvalid'));
  const frames = Math.floor(pcm.length / channels);
  const output = new Uint8Array(SPECTRUM_WIDTH * SPECTRUM_HEIGHT);
  if (!frames) return output;
  const requestFirst = window ? Math.round(window.requestStartMs * rate / 1e3) : 0;
  const coreFirst = window ? Math.round(window.coreStartMs * rate / 1e3) : 0;
  const coreLast = window ? Math.round(window.coreEndMs * rate / 1e3) : frames;
  const mediaLast = window ? window.requestEndMs >= window.durationMs ? requestFirst + frames : Math.round(window.durationMs * rate / 1e3) : frames;
  const real = new Float32Array(SIZE), imaginary = new Float32Array(SIZE);
  const bins = binMapForRate(rate);
  const invScale = 1 / (channels * 32768);
  const ampScale = 4 / SIZE;
  const halfSize = SIZE >> 1;
  const coreSpan = coreLast - coreFirst;
  for (let column = 0; column < SPECTRUM_WIDTH; column++) {
    const center = coreFirst + Math.round((column + 0.5) / SPECTRUM_WIDTH * coreSpan) - requestFirst;
    for (let index = 0; index < SIZE; index++) {
      const frame = center + index - halfSize;
      const absolute = frame + requestFirst;
      if ((frame < 0 || frame >= frames) && absolute >= 0 && absolute < mediaLast) throw new MessageError(message('spectrum.contextMissing'));
      let sample = 0;
      if (frame >= 0 && frame < frames) {
        const base = frame * channels;
        for (let channel = 0; channel < channels; channel++) sample += pcm[base + channel];
      }
      real[index] = sample * invScale * HANN_WINDOW[index];
      imaginary[index] = 0;
    }
    fft(real, imaginary);
    for (let row = 0; row < SPECTRUM_HEIGHT; row++) {
      const position = bins[row], low = Math.floor(position), high = Math.min(halfSize, low + 1);
      const fraction = position - low;
      const amplitude = (Math.hypot(real[low], imaginary[low]) * (1 - fraction) + Math.hypot(real[high], imaginary[high]) * fraction) * ampScale;
      const db = 20 * Math.log10(Math.max(1e-6, amplitude));
      output[(SPECTRUM_HEIGHT - row - 1) * SPECTRUM_WIDTH + column] = Math.max(0, Math.min(255, Math.round((db + 70) / 70 * 255)));
    }
  }
  return output;
}
