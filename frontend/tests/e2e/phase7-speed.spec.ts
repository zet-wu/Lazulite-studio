import { expect, test, type Page } from '@playwright/test';
import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
test.use({ launchOptions: { ignoreDefaultArgs: ['--mute-audio'] } });
async function speed(page: Page, rate: number) {
  await page.getByRole('slider', { name: '播放速度', exact: true }).evaluate((element: HTMLInputElement, value) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, String(value));
    element.dispatchEvent(new Event('input', { bubbles: true })); element.dispatchEvent(new Event('change', { bubbles: true }));
  }, rate);
  await expect.poll(() => page.locator('audio').evaluate((el: HTMLAudioElement) => el.playbackRate)).toBe(rate);
}
test('P7 speed supports immediate slider, wheel, trackpad, keyboard, clamps and preferences without history', async ({ page }) => {
  await page.goto('/projects/sample-project/edit');
  const control = page.getByRole('slider', { name: '播放速度', exact: true }); await expect(control).toBeEnabled();
  await speed(page, .1); await expect(control).toHaveValue('0.1');
  await control.dispatchEvent('wheel', { deltaY: 40, deltaMode: 0 }); await expect(control).toHaveValue('0.1');
  await control.dispatchEvent('wheel', { deltaY: -40, deltaMode: 0 }); await expect(control).toHaveValue('0.15');
  for (let i = 0; i < 4; i++) await control.dispatchEvent('wheel', { deltaY: -10, deltaMode: 0 }); await expect(control).toHaveValue('0.2');
  await control.dispatchEvent('wheel', { deltaY: -3, deltaMode: 1 }); await expect(control).toHaveValue('0.25');
  await control.focus(); await control.press('End'); await expect(control).toHaveValue('2');
  await control.dispatchEvent('wheel', { deltaY: -400, deltaMode: 0 }); await expect(control).toHaveValue('2');
  await control.press('ArrowLeft'); await expect(control).toHaveValue('1.95');
  const position = await page.locator('audio').evaluate((el: HTMLAudioElement) => el.currentTime);
  await page.getByRole('button', { name: '恢复 1 倍速度' }).click(); await expect(control).toHaveValue('1');
  expect(await page.locator('audio').evaluate((el: HTMLAudioElement) => el.currentTime)).toBe(position);
  await speed(page, .25); await page.reload(); await expect(control).toHaveValue('0.25');
  expect(await page.locator('audio').evaluate((el: HTMLAudioElement) => el.preservesPitch)).toBe(true);
  await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeDisabled();
  await page.getByLabel('可编辑时间轴').dispatchEvent('wheel', { deltaY: -100, deltaMode: 0 }); await expect(control).toHaveValue('0.25');
});

test('P7 actual transport measures audible 440Hz signal across all required rates with a pitch-shift control', async ({ page }) => {
  test.skip(!process.env.STUDIO_AUDIO_PROBE_SINK, 'Provide an isolated PulseAudio sink for actual output capture.');
  await page.goto('/projects/sample-project/edit'); await expect(page.getByRole('slider', { name: '播放速度', exact: true })).toBeEnabled();
  await page.evaluate(async () => {
    const sampleRate = 48000, count = sampleRate * 16, buffer = new ArrayBuffer(44 + count * 2), view = new DataView(buffer);
    const str = (i: number, s: string) => [...s].forEach((c, j) => view.setUint8(i + j, c.charCodeAt(0)));
    str(0, 'RIFF'); view.setUint32(4, 36 + count * 2, true); str(8, 'WAVE'); str(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); str(36, 'data'); view.setUint32(40, count * 2, true);
    for (let i = 0; i < count; i++) view.setInt16(44 + i * 2, Math.sin(2 * Math.PI * 440 * i / sampleRate) * 16000, true);
    const audio = document.querySelector('audio')!;
    const url = URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' })); audio.src = url;
    (window as unknown as { pitchProbe: unknown }).pitchProbe = { url };
  });
  const measure = async () => {
    const chunks: Buffer[] = [];
    const ffmpeg = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'pulse', '-i', `${process.env.STUDIO_AUDIO_PROBE_SINK}.monitor`, '-t', '1.2', '-f', 's16le', '-ac', '1', '-ar', '48000', 'pipe:1']);
    ffmpeg.stdout.on('data', chunk => chunks.push(chunk));
    let error = ''; ffmpeg.stderr.on('data', chunk => { error += String(chunk); });
    await new Promise<void>((resolve, reject) => { ffmpeg.on('error', reject); ffmpeg.on('close', code => code === 0 ? resolve() : reject(new Error(error))); });
    const buffer = Buffer.concat(chunks), values = [];
    for (let i = Math.max(0, buffer.length - 48000); i < buffer.length; i += 2) values.push(buffer.readInt16LE(i) / 32768);
    const rms = Math.sqrt(values.reduce((sum, x) => sum + x * x, 0) / values.length);
    const crossings = values.flatMap((value, index) => index > 0 && values[index - 1] <= 0 && value > 0 ? [index] : []);
    const peakHz = crossings.length > 1 ? (crossings.length - 1) * 48000 / (crossings.at(-1)! - crossings[0]) : 0;
    const status = await page.locator('audio').evaluate((audio: HTMLAudioElement) => ({ position: audio.currentTime, rate: audio.playbackRate, preservesPitch: audio.preservesPitch, paused: audio.paused }));
    return { rms, peakHz, samples: values.length, ...status };
  };
  const results = [];
  for (const rate of [.1, .25, .5, 1, 1.5, 2]) {
    await page.locator('audio').evaluate((audio: HTMLAudioElement) => { audio.pause(); audio.currentTime = .4; });
    await speed(page, rate);
    await page.getByRole('button', { name: '播放', exact: true }).click();
    await page.waitForTimeout(800);
    const sample = await measure(); results.push(sample);
    expect(sample.rms).toBeGreaterThan(.1); expect(Math.abs(sample.peakHz - 440)).toBeLessThan(8); expect(sample.position).toBeGreaterThan(.4); expect(sample.preservesPitch).toBe(true);
  }
  await speed(page, .5); await page.locator('audio').evaluate((el: HTMLAudioElement) => { el.currentTime = .4; el.preservesPitch = false; });
  await page.waitForTimeout(800); const shifted = await measure(); expect(Math.abs(shifted.peakHz - 220)).toBeLessThan(8);
  await page.locator('audio').evaluate((el: HTMLAudioElement) => { el.pause(); el.preservesPitch = true; });
  await page.evaluate(() => URL.revokeObjectURL((window as unknown as { pitchProbe: { url: string } }).pitchProbe.url));
  await writeFile(test.info().outputPath('pitch.json'), JSON.stringify({ userAgent: await page.evaluate(() => navigator.userAgent), path: 'Actual Studio HTMLMediaElement native preservesPitch; isolated PipeWire/PulseAudio sink monitor capture via ffmpeg, RMS and zero-crossing frequency over last 0.5s of 440Hz PCM WAV. Does not prove hardware output or voice quality on Windows/macOS.', results, shifted }, null, 2));
});
