import { test, expect, type Page } from '@playwright/test';
import { mkdir, readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { importLyrics } from '../fixtures/import-lyrics';

const evidence = process.env.STUDIO_DEMO_EVIDENCE_DIR || 'test-results/demo-evidence';
const xml = '<tt xmlns="http://www.w3.org/ns/ttml" xml:lang="ja"><body><div><p begin="1" end="3"><span begin="1" end="2">あ</span><span begin="2" end="3">い</span></p><p begin="4" end="6"><span begin="4" end="5">hello </span><span begin="5" end="6">world</span></p></div></body></tt>';

function wave() {
  const rate = 16000, frames = rate * 12, buffer = Buffer.alloc(44 + frames * 2);
  buffer.write('RIFF', 0); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24); buffer.writeUInt32LE(rate * 2, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36); buffer.writeUInt32LE(frames * 2, 40);
  for (let frame = 0; frame < frames; frame++) buffer.writeInt16LE(Math.round(12000 * Math.sin(frame / rate * Math.PI * 880)), 44 + frame * 2);
  return { name: 'demo-tone.wav', mimeType: 'audio/wav', buffer };
}

async function create(page: Page, audio = true) {
  await page.goto('/projects');
  await page.getByRole('button', { name: '新建项目', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '新建项目', exact: true });
  await dialog.locator('input').first().fill('本地演示');
  if (audio) await dialog.locator('input[type=file]').setInputFiles(wave());
  await dialog.getByRole('button', { name: audio ? '上传并创建' : '创建项目', exact: true }).click();
  await expect(page).toHaveURL(/\/projects\/[^/]+\/edit$/);
  await expect(page.getByRole('button', { name: '歌词获取', exact: true })).toBeVisible();
}
async function screenshot(page: Page, name: string) { await mkdir(evidence, { recursive: true }); await page.screenshot({ path: path.join(evidence, name), fullPage: true }); }
async function save(page: Page) {
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByText('已保存', { exact: true })).toBeVisible();
}

// Every scenario observes the real production page, including worker and media traffic.
test.beforeEach(async ({ page, context }) => {
  const api: string[] = [], failures: string[] = [], exceptions: string[] = [], consoleErrors: string[] = [], localMediaCancellations: string[] = [];
  const observe = (observed: Page) => {
  observed.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/v1')) api.push(request.url()); });
  observed.on('requestfailed', request => {
    const failure = `${request.url()}: ${request.failure()?.errorText}`;
    if (request.url().startsWith('blob:') && request.failure()?.errorText === 'net::ERR_ABORTED') localMediaCancellations.push(failure);
    else failures.push(failure);
  });
  observed.on('response', response => { if (response.status() >= 400) failures.push(`${response.status()} ${response.url()}`); });
  observed.on('pageerror', error => exceptions.push(error.message));
  observed.on('console', entry => { if (entry.type() === 'error') consoleErrors.push(entry.text()); });
  };
  observe(page); context.on('page', observe);
  (page as Page & { demoAudit: unknown }).demoAudit = { api, failures, exceptions, consoleErrors, localMediaCancellations };
});
test.afterEach(async ({ page }, info) => {
  const audit = (page as Page & { demoAudit: unknown }).demoAudit;
  await mkdir(evidence, { recursive: true });
  await writeFile(path.join(evidence, `${info.title.replace(/[^a-z0-9-]/gi, '_')}-network.json`), JSON.stringify(audit, null, 2));
  expect(audit).toMatchObject({ api: [], failures: [], exceptions: [], consoleErrors: [] });
});

test('audio-edit-export-persistence', async ({ page }) => {
  await page.goto('/projects'); await screenshot(page, '01-empty-light-1440.png');
  await create(page);
  const audio = page.locator('audio');
  await expect.poll(() => audio.evaluate((element: HTMLAudioElement) => element.readyState)).toBeGreaterThanOrEqual(1);
  expect(await audio.evaluate((element: HTMLAudioElement) => element.src)).toMatch(/^blob:/);
  await page.getByRole('button', { name: '播放', exact: true }).click();
  await expect.poll(() => audio.evaluate((element: HTMLAudioElement) => element.currentTime)).toBeGreaterThan(0);
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  await importLyrics(page, { name: 'local.ttml', mimeType: 'application/xml', buffer: Buffer.from(xml) });
  const word = page.getByRole('textbox', { name: '词 hello ', exact: true });
  await word.fill('hello demo '); await word.press('Tab');
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(word).toHaveValue('hello ');
  await page.getByRole('button', { name: '重做', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '词 hello demo ', exact: true })).toHaveValue('hello demo ');
  await save(page);
  await page.getByRole('button', { name: '声谱图', exact: true }).click();
  await expect(page.locator('[data-spectrum-ready]')).toHaveAttribute('data-spectrum-ready', /[1-9]/);
  await expect.poll(() => page.locator('[role=slider] canvas').first().evaluate((canvas: HTMLCanvasElement) => canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data.some((value, index) => index % 4 === 3 && value > 0))).toBe(true);
  await screenshot(page, '02-waveform-spectrum-light-1440.png');
  for (const theme of ['dark', 'light']) {
    await page.locator('[data-settings-button]').click();
    await page.getByRole('dialog', { name: '设置', exact: true }).getByLabel('主题', { exact: true }).selectOption(theme);
    await page.keyboard.press('Escape');
    await screenshot(page, `02-workspace-${theme}-1440.png`);
    await page.setViewportSize({ width: 1024, height: 768 });
    await screenshot(page, `02-workspace-${theme}-1024.png`);
    await page.setViewportSize({ width: 1440, height: 1000 });
  }
  await page.getByRole('button', { name: '放大波形', exact: true }).click();
  await page.getByRole('button', { name: 'AMLL 预览', exact: true }).click();
  await expect(page.locator('[class*="preview"]')).not.toHaveCount(0);
  await screenshot(page, '03-amll-preview-1440.png');
  await page.getByRole('button', { name: '文件打包', exact: true }).click();
  const output = page.locator('#output-panel-lyrics');
  const exports: { format: string; filename: string; bytes: number }[] = [];
  for (const format of ['ttml', 'lrc', 'elrc', 'eslrc', 'qrc', 'yrc', 'lys', 'ass', 'nicokara', 'sug']) {
    await page.getByLabel('导出格式', { exact: true }).selectOption(format);
    const download = page.waitForEvent('download');
    await output.getByRole('button', { name: /^导出 / }).click();
    const file = await download, bytes = await readFile((await file.path())!);
    expect(bytes.byteLength).toBeGreaterThan(0);
    exports.push({ format, filename: file.suggestedFilename(), bytes: bytes.byteLength });
  }
  await writeFile(path.join(evidence, 'exports.json'), JSON.stringify(exports, null, 2));
  await save(page);
  await page.reload();
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '词 hello demo ', exact: true })).toHaveValue('hello demo ');
  await expect.poll(() => audio.evaluate((element: HTMLAudioElement) => element.readyState)).toBeGreaterThanOrEqual(1);
  expect(await audio.evaluate((element: HTMLAudioElement) => element.duration)).toBeCloseTo(12, 1);
  await page.getByRole('link', { name: 'Lazulite Studio', exact: true }).click();
  await expect(page.getByRole('link', { name: /本地演示/ })).toBeVisible();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: '删除项目 本地演示', exact: true }).click();
  await expect(page.getByText('还没有项目', { exact: true })).toBeVisible();
  const counts = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('lazulite-studio-browser-v1', 1); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const counts = await Promise.all(['projects', 'documents', 'assets'].map(store => new Promise<number>(resolve => { const request = db.transaction(store).objectStore(store).count(); request.onsuccess = () => resolve(request.result); })));
    db.close(); return counts;
  });
  expect(counts).toEqual([0, 0, 0]);
});

test('desktop-guidance-and-settings', async ({ page }) => {
  await page.goto('/projects');
  const importButton = page.getByRole('button', { name: '导入项目', exact: true });
  await importButton.click();
  const notice = page.getByRole('dialog', { name: '仅桌面完整版支持', exact: true });
  await expect(notice.getByRole('link')).toHaveAttribute('href', 'https://github.com/zet-wu/Lazulite-studio/releases');
  await page.keyboard.press('Tab'); await page.keyboard.press('Tab');
  expect(await notice.evaluate(element => element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape'); await expect(importButton).toBeFocused();
  await create(page);
  await page.getByRole('button', { name: '歌词获取', exact: true }).click();
  await expect(page.getByRole('tab', { name: '文件', exact: true })).toHaveAttribute('aria-selected', 'true');
  for (const name of ['网易云音乐', 'QQ 音乐', '酷狗', 'AMLL DB', '内嵌']) {
    await page.getByRole('tab', { name, exact: true }).click();
    await expect(page.getByText('仅桌面完整版支持', { exact: true })).toBeVisible();
  }
  await importLyrics(page, { name: 'local.ttml', mimeType: 'application/xml', buffer: Buffer.from(xml) });
  await page.locator('[data-outline-drag]').first().click();
  for (const name of ['智能日文注音', '词典注音', '简繁／中日汉字转换']) {
    await page.locator('[data-top-menu="tools"] summary').click();
    await page.getByRole('button', { name, exact: true }).click();
    await expect(notice).toBeVisible(); await page.keyboard.press('Escape');
  }
  await page.getByRole('button', { name: '音频处理', exact: true }).click();
  for (const name of ['分离人声', '自动对齐']) {
    await page.getByRole('button', { name, exact: true }).click();
    await expect(notice).toBeVisible(); await page.keyboard.press('Escape');
  }
  await page.getByRole('button', { name: '文件打包', exact: true }).click();
  await page.getByRole('tab', { name: '音乐文件嵌入', exact: true }).click();
  await expect(page.getByText('仅桌面完整版支持', { exact: true })).toBeVisible();
  await page.locator('[data-settings-button]').click();
  const settings = page.getByRole('dialog', { name: '设置', exact: true });
  await settings.getByRole('button', { name: '注音与拉丁化', exact: true }).click();
  await expect(settings.getByText('仅桌面完整版支持', { exact: true })).toBeVisible();
  await expect(settings.getByRole('switch', { name: /助词/ })).toBeVisible();
  await settings.getByRole('button', { name: '模型与计算', exact: true }).click();
  await expect(settings.getByText('仅桌面完整版支持', { exact: true })).toBeVisible();
  await screenshot(page, '04-desktop-guidance-settings.png');
  await page.keyboard.press('Escape');
  await save(page);
  await page.getByRole('link', { name: 'Lazulite Studio', exact: true }).click();
  await page.getByRole('button', { name: /导出项目 本地演示/ }).click();
  await expect(notice).toBeVisible();
});

test('audio-quota-session-fallback', async ({ page }) => {
  await page.addInitScript(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value: unknown, key?: IDBValidKey) {
      if (this.name === 'assets' && value && typeof value === 'object' && 'blob' in value) throw new DOMException('Quota full', 'QuotaExceededError');
      return put.call(this, value, key);
    };
  });
  await create(page);
  await expect(page.getByText(/当前音频仅保留在本次会话中/)).toBeVisible();
  await expect.poll(() => page.locator('audio').evaluate((element: HTMLAudioElement) => element.readyState)).toBeGreaterThanOrEqual(1);
  await screenshot(page, '05-quota-fallback.png');
  await page.reload();
  await expect(page.getByText('此音频未保存在浏览器中，请重新选择本地音频。', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '播放', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '音频处理', exact: true }).click();
  await page.getByRole('button', { name: '替换音频', exact: true }).click();
  await page.locator('input[aria-label="导入音频文件"]').setInputFiles(wave());
  await expect.poll(() => page.locator('audio').evaluate((element: HTMLAudioElement) => element.readyState)).toBeGreaterThanOrEqual(1);
});

for (const theme of ['light', 'dark']) test(`preferences-${theme}-1024`, async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await create(page, false);
  await page.locator('[data-settings-button]').click();
  const settings = page.getByRole('dialog', { name: '设置', exact: true });
  await settings.getByLabel('主题', { exact: true }).selectOption(theme);
  await screenshot(page, `06-settings-${theme}-1024.png`);
  await page.keyboard.press('Escape');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
});

test('audio-formats-replacement-and-release', async ({ page }) => {
  await page.addInitScript(() => {
    const revoked: string[] = [];
    (window as Window & { demoRevoked?: string[] }).demoRevoked = revoked;
    const revoke = URL.revokeObjectURL;
    URL.revokeObjectURL = url => { revoked.push(url); revoke.call(URL, url); };
  });
  await create(page);
  await page.getByRole('button', { name: '音频处理', exact: true }).click();
  const formats: { format: string; bytes: number; duration?: number; supported: boolean }[] = [];
  for (const [format, mimeType, arguments_] of [
    ['mp3', 'audio/mpeg', ['-f', 'mp3']],
    ['flac', 'audio/flac', ['-f', 'flac']],
    ['m4a', 'audio/mp4', ['-c:a', 'aac', '-movflags', 'frag_keyframe+empty_moov', '-f', 'ipod']],
    ['ogg', 'audio/ogg', ['-c:a', 'libvorbis', '-f', 'ogg']],
  ] as const) {
    const directory = await mkdtemp(path.join(tmpdir(), 'studio-demo-audio-'));
    const filename = path.join(directory, `tone.${format}`);
    execFileSync('ffmpeg', ['-v', 'error', '-i', 'pipe:0', ...arguments_, filename], { input: wave().buffer });
    const encoded = await readFile(filename);
    await rm(directory, { recursive: true });
    const audio = page.locator('audio'), previous = await audio.getAttribute('src');
    await page.getByRole('button', { name: '替换音频', exact: true }).click();
    await page.locator('input[aria-label="导入音频文件"]').setInputFiles({ name: `tone.${format}`, mimeType, buffer: encoded });
    if (format === 'm4a' && !await audio.evaluate((element: HTMLAudioElement) => element.canPlayType('audio/mp4; codecs="mp4a.40.2"'))) {
      await expect(page.getByRole('alert').filter({ hasText: /浏览器无法解码此音频/ })).toBeVisible();
      await expect(audio).toHaveAttribute('src', previous!);
      formats.push({ format, bytes: encoded.byteLength, supported: false });
      continue;
    }
    await expect(audio).not.toHaveAttribute('src', previous!);
    await expect.poll(() => audio.evaluate((element: HTMLAudioElement) => element.readyState)).toBeGreaterThanOrEqual(1);
    const duration = await audio.evaluate((element: HTMLAudioElement) => element.duration);
    expect(duration).toBeGreaterThan(11); expect(duration).toBeLessThan(13);
    expect(await page.evaluate(url => (window as Window & { demoRevoked?: string[] }).demoRevoked?.includes(url!), previous)).toBe(true);
    formats.push({ format, bytes: encoded.byteLength, duration, supported: true });
  }
  const current = await page.locator('audio').getAttribute('src');
  await page.getByRole('button', { name: '替换音频', exact: true }).click();
  await page.locator('input[aria-label="导入音频文件"]').setInputFiles({ name: 'broken.wav', mimeType: 'audio/wav', buffer: Buffer.from('broken audio') });
  await expect(page.getByRole('alert').filter({ hasText: /浏览器无法解码此音频/ })).toBeVisible();
  await expect(page.locator('audio')).toHaveAttribute('src', current!);
  await page.getByRole('link', { name: 'Lazulite Studio', exact: true }).click();
  await expect.poll(() => page.evaluate(url => (window as Window & { demoRevoked?: string[] }).demoRevoked?.includes(url!), current)).toBe(true);
  await writeFile(path.join(evidence, 'audio-formats.json'), JSON.stringify(formats, null, 2));
});

test('timing-speed-loop-and-timeline', async ({ page }) => {
  await create(page);
  await importLyrics(page, { name: 'timing.ttml', mimeType: 'application/xml', buffer: Buffer.from(xml.replace(/<p begin="4"[\s\S]*?<\/p>/, '')) });
  const audio = page.locator('audio');
  const speed = page.getByRole('slider', { name: '播放速度', exact: true });
  await speed.press('Home'); await expect.poll(() => audio.evaluate((element: HTMLAudioElement) => element.playbackRate)).toBeCloseTo(0.1);
  await page.getByRole('button', { name: '恢复 1 倍速度', exact: true }).click();
  const seek = async (time: number) => audio.evaluate((element: HTMLAudioElement, time) => { element.currentTime = time; }, time);
  await seek(1); await page.getByRole('button', { name: /^A / }).click();
  await seek(2); await page.getByRole('button', { name: /^B / }).click();
  await page.getByRole('button', { name: '循环 A/B', exact: true }).click();
  await seek(1.95); await page.getByRole('button', { name: '播放', exact: true }).click();
  await expect.poll(() => audio.evaluate((element: HTMLAudioElement) => element.currentTime)).toBeLessThan(1.8);
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  await page.getByRole('button', { name: '循环 A/B', exact: true }).click();
  await page.locator('main [data-word-id]').first().click({ position: { x: 2, y: 2 } });
  await page.getByRole('navigation', { name: '工作模式' }).getByRole('button', { name: '打轴', exact: true }).click();
  await seek(1.2); await page.keyboard.press('d');
  await seek(2.2); await page.keyboard.down('d');
  await seek(2.6); await page.keyboard.up('d');
  await page.getByRole('button', { name: '上一单元', exact: true }).click();
  await page.getByRole('button', { name: '下一单元', exact: true }).click();
  await expect(page.getByLabel('选中对象结束秒数', { exact: true })).toHaveValue('2.6');
  await page.locator('[data-settings-button]').click();
  const settings = page.getByRole('dialog', { name: '设置', exact: true });
  await settings.getByRole('button', { name: '打轴', exact: true }).click();
  await settings.getByLabel('打轴风格', { exact: true }).selectOption('amll');
  await page.keyboard.press('Escape');
  await expect(page.locator('main [data-sync-marker="stop"]')).toHaveCount(0);
  await page.getByRole('button', { name: '上一单元', exact: true }).click();
  await seek(1.1); await page.getByRole('button', { name: '起始轴', exact: true }).click();
  await expect(page.getByLabel('选中对象开始秒数', { exact: true })).toHaveValue('1.1');
  await screenshot(page, '07-amll-timing.png');
  await save(page);
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  const waveform = page.getByRole('slider', { name: '波形进度', exact: true });
  await waveform.click({ position: { x: 100, y: 20 } });
  await expect.poll(() => audio.evaluate((element: HTMLAudioElement) => element.currentTime)).toBeGreaterThan(0);
  await page.locator('[data-outline-drag]').first().click();
  await page.getByRole('checkbox', { name: '吸附', exact: true }).uncheck();
  const next = page.getByRole('button', { name: '时间轴词 い', exact: true });
  const original = (await next.boundingBox())!.x;
  const edge = page.getByLabel('时间轴词 あ结束边界', { exact: true });
  const rect = (await edge.boundingBox())!;
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2); await page.mouse.down();
  await page.mouse.move(rect.x + rect.width / 2 + 24, rect.y + rect.height / 2, { steps: 4 }); await page.mouse.up();
  await expect.poll(async () => (await next.boundingBox())!.x).toBeGreaterThan(original + 10);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect.poll(async () => (await next.boundingBox())!.x).toBeCloseTo(original, 0);
});

test('local-romaji-and-english-syllables', async ({ page }) => {
  await create(page, false);
  await importLyrics(page, { name: 'readings.ttml', mimeType: 'application/xml', buffer: Buffer.from(xml.replace('hello ', 'beautiful ')) });
  await page.locator('[data-outline-drag]').first().click();
  await page.locator('[data-top-menu="tools"] summary').click();
  await page.getByRole('button', { name: '生成日文罗马字音译', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText(/在线演示按已有注音或假名生成罗马字/)).toBeVisible();
  await dialog.getByRole('button', { name: '生成音译', exact: true }).click();
  await expect(page.locator('[data-romanization-content-id]')).not.toHaveCount(0);
  await page.locator('[data-outline-drag]').nth(1).click();
  await page.locator('[data-top-menu="tools"] summary').click();
  await page.getByRole('button', { name: '批处理', exact: true }).click();
  await dialog.getByRole('button', { name: '分词', exact: true }).click();
  await dialog.getByRole('combobox', { name: '模式', exact: true }).selectOption('auto');
  await dialog.getByRole('combobox', { name: '西文处理', exact: true }).selectOption('syllable');
  await dialog.getByRole('combobox', { name: '音节语言', exact: true }).selectOption('en-us');
  await dialog.getByRole('button', { name: '应用', exact: true }).click();
  await expect(page.locator('main [data-word-id]')).not.toHaveCount(4);
  await save(page);
});

test('cross-tab-document-conflict', async ({ page, context }) => {
  await create(page, false);
  await importLyrics(page, { name: 'local.ttml', mimeType: 'application/xml', buffer: Buffer.from(xml) });
  await save(page);
  const other = await context.newPage(); await other.goto(page.url());
  await other.getByRole('button', { name: '编辑', exact: true }).click();
  await page.getByRole('textbox', { name: '词 あ', exact: true }).fill('ああ'); await page.keyboard.press('Tab');
  await other.getByRole('textbox', { name: '词 あ', exact: true }).fill('あい'); await other.keyboard.press('Tab');
  await save(page);
  await expect(other.getByText('检测到外部更新，当前有未保存修改', { exact: true })).toBeVisible();
  await other.getByRole('button', { name: '重新加载外部版本', exact: true }).click();
  await expect(other.getByRole('textbox', { name: '词 ああ', exact: true })).toHaveValue('ああ');
  await other.close();
});

test('local-text-lrc-and-sug-import', async ({ page }) => {
  await create(page, false);
  await importLyrics(page, { name: 'local.lrc', mimeType: 'text/plain', buffer: Buffer.from('[00:01.00]本地歌词\n[00:03.00]第二行\n') });
  await expect(page.getByRole('textbox', { name: '词 本地歌词', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '歌词获取', exact: true }).click();
  await page.getByRole('tab', { name: '文本', exact: true }).click();
  await page.getByRole('textbox', { name: '待导入歌词文本', exact: true }).fill('かな\nhello world');
  await page.getByRole('button', { name: '预览文本', exact: true }).click();
  await page.getByRole('button', { name: '确认导入并替换歌词', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '词 かな', exact: true })).toBeVisible();
  await importLyrics(page, path.resolve('tests/fixtures/external-current.sug'));
  const count = await page.locator('main [data-word-id]').count();
  expect(count).toBeGreaterThan(0);
  await save(page); await page.reload();
  await expect(page.locator('main [data-word-id]')).toHaveCount(count);
});

test('disabled-project-storage-guidance', async ({ page }) => {
  await page.addInitScript(() => {
    const open = IDBFactory.prototype.open;
    IDBFactory.prototype.open = function (name, version) {
      if (name === 'lazulite-studio-browser-v1') throw new DOMException('Blocked', 'SecurityError');
      return open.call(this, name, version);
    };
  });
  await page.goto('/projects');
  await expect(page.getByText('浏览器项目存储不可用，请允许此网站使用本地存储后重试。', { exact: true })).toBeVisible();
});

test('browser-language-persistence', async ({ page }) => {
  await page.goto('/projects');
  for (const [locale, badge] of [['zh-Hant', '線上示範'], ['en', 'Online demo']]) {
    await page.locator('[data-settings-button]').click();
    await page.getByRole('dialog').locator('select[data-initial-focus]').selectOption(locale);
    await expect(page.getByText(badge, { exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await page.reload();
    await expect(page.getByText(badge, { exact: true })).toBeVisible();
    await screenshot(page, `08-empty-${locale}-1440.png`);
  }
});
