import { expect, test, type Page } from '@playwright/test';
import { importLyrics } from '../fixtures/import-lyrics';
import { writeFile } from 'node:fs/promises';
import { phase7Ttml } from '../fixtures/phase7';
async function load(page: Page, project = false, xml = phase7Ttml) {
  await page.goto(project ? '/projects/sample-project/edit' : '/editor');
  await importLyrics(page, { name: 'phase2.ttml', mimeType: 'application/xml', buffer: Buffer.from(xml) });
}
async function edge(page: Page, selector: string, index = 0, right = false) {
  await page.locator(selector).nth(index).click({ position: { x: 3, y: 3 }, button: right ? 'right' : 'left' });
}
test('single click, Tab and all inline reading entry points preserve cancellation and one undo', async ({ page }) => {
  await load(page);
  const reading = page.getByRole('textbox', { name: '读音 学校', exact: true }).first();
  await reading.click(); await page.keyboard.press('ControlOrMeta+A'); await page.keyboard.type('ka'); await page.keyboard.press('Enter');
  await expect(reading).toHaveValue('ka');
  await page.getByRole('button', { name: '撤销', exact: true }).click(); await expect(reading).toHaveValue('が');
  await edge(page, '[data-ruby-id]'); await page.keyboard.press('Tab');
  await expect(reading).toBeFocused(); await page.keyboard.press('End'); await page.keyboard.type('x'); await page.keyboard.press('Escape'); await expect(reading).toHaveValue('が');
  await edge(page, '[data-ruby-id]', 0, true); await page.getByRole('menuitem', { name: '添加读音', exact: true }).click();
  const draft = page.getByRole('textbox', { name: '新增读音 学校' }); await expect(draft).toBeFocused();
  await page.keyboard.type('new'); await page.keyboard.press('Enter');
  await expect(page.getByRole('textbox', { name: '读音 学校', exact: true }).nth(1)).toHaveValue('new');
  await expect(page.getByRole('textbox', { name: '读音 new开始秒数' })).toHaveValue('');
  await page.getByRole('button', { name: '撤销', exact: true }).click(); await expect(page.locator('[data-ruby-id]')).toHaveCount(4);
  await edge(page, 'main [data-word-id]', 0, true); await page.getByRole('menuitem', { name: '添加注音', exact: true }).click();
  await expect(draft).toBeFocused(); await page.keyboard.type('cancel'); await page.keyboard.press('Escape');
  await expect(page.locator('[data-ruby-id]')).toHaveCount(4); await expect(draft).toHaveCount(0);
  const word = page.getByRole('textbox', { name: '词 学校', exact: true }); await word.click(); await page.keyboard.press('End'); await page.keyboard.type('|'); await page.keyboard.press('Enter');
  await expect(draft).toBeFocused(); await page.keyboard.type('last'); await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '读音 学校', exact: true }).last()).toHaveValue('last');
});
test('canvas drives timing, line completion blocks repeat and same target can be explicitly selected again', async ({ page }) => {
  await load(page, true);
  await edge(page, '[data-ruby-id]', 2); await page.getByRole('button', { name: '打轴', exact: true }).click();
  const panel = page.getByRole('region', { name: '连续打轴' }); await expect(panel).toContainText('L1 · 单元 3 / 4');
  await page.getByRole('combobox', { name: '打轴模式' }).selectOption('line');
  await edge(page, '[data-ruby-id]', 3); await expect(panel).toContainText('L1 · 单元 4 / 4');
  await page.locator('audio').evaluate((a: HTMLAudioElement) => { a.currentTime = 3.5; });
  await panel.getByRole('button', { name: '连续轴', exact: true }).click(); await expect(panel).toContainText('本行已完成');
  await expect(page.getByRole('textbox', { name: '词 しん开始秒数' })).toHaveValue('4');
  await expect(panel.getByRole('button', { name: '连续轴', exact: true })).toBeDisabled();
  await edge(page, '[data-ruby-id]', 3); await expect(panel.getByRole('button', { name: '连续轴', exact: true })).toBeEnabled();
  await page.getByRole('textbox', { name: '词 よう', exact: true }).click(); await expect(panel).toContainText('L2 · 单元 2 / 2');
  await page.keyboard.press('End'); await page.keyboard.type('sdf'); await expect(page.getByRole('textbox', { name: '词 よう', exact: true })).toHaveValue('ようsdf');
});
test('exactly twelve global bindings, conflict rejection, modifier routing and reload persistence', async ({ page }) => {
  await load(page, true);
  await page.locator('[data-top-menu="settings"] summary').click(); await page.getByRole('button', { name: '快捷键设置', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '快捷键设置' }); await expect(dialog.getByRole('textbox')).toHaveCount(12);
  const start = dialog.getByRole('textbox', { name: '起始轴快捷键' }); await start.click(); await page.keyboard.press('Space'); await expect(dialog.getByRole('alert')).toContainText('冲突');
  await page.keyboard.press('Shift+G'); await expect(start).toHaveValue('Shift + G');
  await page.keyboard.press('Escape'); await page.getByRole('button', { name: '打轴', exact: true }).click();
  await edge(page, '[data-ruby-id]'); await page.keyboard.press('Shift+G');
  await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeEnabled();
  await page.reload(); await page.locator('[data-top-menu="settings"] summary').click(); await page.getByRole('button', { name: '快捷键设置', exact: true }).click(); await expect(start).toHaveValue('Shift + G');
});
for (const width of [1280, 1440, 1920]) for (const theme of ['light', 'dark']) test(`equal default bars ${width} ${theme}`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 1000 }); await page.addInitScript(theme => localStorage.setItem('lazulite-editor-theme', theme), theme);
  await load(page, false, phase7Ttml.replace('学校', '学校很长的正文引用'.repeat(8)));
  const top = (await page.getByLabel('歌词列表', { exact: true }).boundingBox())!.y;
  for (let n = 0; n < 2; n++) {
    await page.getByRole('button', { name: '打轴', exact: true }).click();
    expect((await page.getByLabel('歌词列表', { exact: true }).boundingBox())!.y).toBe(top);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`sync-${width}-${theme}.png`) });
    await page.getByRole('button', { name: '编辑', exact: true }).click();
  }
});
test('paused playhead projects into the changed viewport without seeking', async ({ page }) => {
  await page.goto('/projects/sample-project/edit');
  await page.locator('audio').evaluate((a: HTMLAudioElement) => { a.pause(); a.currentTime = 60; });
  await page.getByRole('button', { name: '放大波形' }).click();
  const slider = page.getByRole('slider', { name: '波形进度' });
  await expect(slider).toBeVisible();
  const before = await slider.locator('[class*="head"]').evaluate((el: HTMLElement) => el.style.left);
  await page.getByRole('button', { name: '后移窗口' }).click();
  await expect.poll(() => slider.locator('[class*="head"]').evaluate((el: HTMLElement) => el.style.left)).not.toBe(before);
  expect(await page.locator('audio').evaluate((a: HTMLAudioElement) => a.currentTime)).toBe(60);
});
test('preview fade and emphasis phases follow actual media rates, pause, seek and mode rebuild', async ({ page }, info) => {
  const xml = `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata"><body><p begin="0" end="30"><span begin="0" end="20">Longword </span><span begin="20" end="30">ending</span><span ttm:role="x-bg" begin="0" end="30"><span begin="0" end="20">Background </span><span begin="20" end="30">ending</span></span></p></body></tt>`;
  await load(page, true, xml); await page.getByRole('button', { name: '预览', exact: true }).click();
  await page.evaluate(async () => {
    const count = 48000 * 40, buffer = new ArrayBuffer(44 + count * 2), v = new DataView(buffer);
    const text = (at: number, value: string) => [...value].forEach((char, i) => v.setUint8(at + i, char.charCodeAt(0)));
    text(0, 'RIFF'); v.setUint32(4, 36 + count * 2, true); text(8, 'WAVE'); text(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, 48000, true); v.setUint32(28, 96000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); text(36, 'data'); v.setUint32(40, count * 2, true);
    const audio = document.querySelector('audio')!; audio.src = URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }));
    await new Promise<void>(resolve => audio.addEventListener('loadedmetadata', () => resolve(), { once: true }));
  });
  const snapshots = [];
  for (const rate of [.1, .25, .5, 1, 1.5, 2]) {
    await page.locator('audio').evaluate(async (a: HTMLAudioElement, rate) => { a.currentTime = 1; a.playbackRate = rate; await a.play(); }, rate);
    await expect.poll(() => page.evaluate(() => document.getAnimations().filter(a => a.id.startsWith('fade-word-')).length)).toBeGreaterThan(1);
    await page.waitForTimeout(350);
    const sample = await page.evaluate(() => ({ time: document.querySelector('audio')!.currentTime * 1000, animations: document.getAnimations().filter(a => /^(fade-word-|emphasize-word-|float-word)/.test(a.id)).map(a => ({ id: a.id, time: Number(a.currentTime), rate: a.playbackRate })) }));
    expect(sample.animations.some(a => a.id.startsWith('emphasize-word-'))).toBe(true);
    for (const animation of sample.animations) { expect(animation.rate).toBe(rate); expect(Math.abs(animation.time - sample.time)).toBeLessThan(100); }
    snapshots.push({ rate, ...sample });
  }
  await page.locator('audio').evaluate((a: HTMLAudioElement) => { a.pause(); a.currentTime = 4; }); await page.waitForTimeout(100);
  for (const a of await page.evaluate(() => document.getAnimations().filter(a => a.id.startsWith('fade-word-')).map(a => ({ time: Number(a.currentTime), state: a.playState })))) { expect(a.time).toBeCloseTo(4000, -1); expect(a.state).toBe('paused'); }
  await page.getByRole('button', { name: '编辑', exact: true }).click(); await page.getByRole('button', { name: '预览', exact: true }).click();
  await page.locator('audio').evaluate((a: HTMLAudioElement) => { a.currentTime = 2; }); await page.getByRole('button', { name: /^A / }).click();
  await page.locator('audio').evaluate((a: HTMLAudioElement) => { a.currentTime = 3; }); await page.getByRole('button', { name: /^B / }).click();
  await page.getByRole('button', { name: '循环 A/B', exact: true }).click();
  await page.locator('audio').evaluate(async (a: HTMLAudioElement) => { a.currentTime = 2.9; await a.play(); }); await page.waitForTimeout(350);
  const loop = await page.evaluate(() => ({ time: document.querySelector('audio')!.currentTime * 1000, phases: document.getAnimations().filter(a => a.id.startsWith('fade-word-')).map(a => Number(a.currentTime)) }));
  expect(loop.time).toBeLessThan(3000); expect(loop.phases.length).toBeGreaterThan(1);
  for (const phase of loop.phases) expect(Math.abs(phase - loop.time)).toBeLessThan(100);
  await writeFile(info.outputPath('animation-phases.json'), JSON.stringify({ snapshots, loop }, null, 2));
});

test('invalid timing selections and control/menu focus cannot stamp another object', async ({ page }) => {
  await load(page, true);
  await page.getByRole('button', { name: '打轴', exact: true }).click();
  const panel = page.getByRole('region', { name: '连续打轴' });
  await edge(page, '[data-ruby-id]', 1); await expect(panel).toContainText('单元 2 / 4');
  await page.getByRole('slider', { name: '波形进度' }).focus(); await page.keyboard.press('ArrowRight');
  await expect(panel).toContainText('单元 2 / 4');
  expect(await page.locator('audio').evaluate((a: HTMLAudioElement) => a.currentTime)).toBe(1);
  await page.getByRole('separator', { name: '大纲宽度' }).focus(); await page.keyboard.press('KeyS');
  await expect(page.getByLabel('读音 っ开始秒数')).toHaveValue('1');
  await edge(page, '[data-ruby-id]', 1); await page.locator('[data-top-menu="settings"] summary').click(); await page.keyboard.press('KeyS');
  await expect(page.getByLabel('读音 っ开始秒数')).toHaveValue('1'); await page.keyboard.press('Escape');
  await page.getByRole('switch', { name: '跳过打轴' }).check(); await edge(page, '[data-ruby-id]', 1);
  await expect(panel).toContainText('当前选择不参与打轴'); await expect(panel.getByRole('button', { name: '起始轴' })).toBeDisabled();
  await page.keyboard.press('KeyD'); await expect(page.getByLabel('词 しん开始秒数')).toHaveValue('4');
});
test('singer form validates locally and reading draft protects composition and empty cancellation', async ({ page }) => {
  await load(page);
  await page.locator('[data-top-menu="lyrics-settings"] summary').click(); await page.getByRole('button', { name: '歌手管理', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '歌手管理' }); await dialog.getByRole('button', { name: '添加歌手' }).click();
  await dialog.getByLabel('歌手 ID', { exact: true }).fill('bad id'); await dialog.getByLabel('歌手 ID', { exact: true }).press('Enter'); await expect(dialog.getByRole('alert')).toBeVisible();
  await dialog.getByLabel('歌手 ID', { exact: true }).fill('singer'); await dialog.getByLabel('歌手 ID', { exact: true }).press('Enter'); await dialog.getByLabel('歌手 singer', { exact: true }).fill('歌手'); await dialog.getByLabel('歌手 singer', { exact: true }).press('Enter');
  await expect(dialog.getByRole('textbox', { name: '歌手 singer', exact: true })).toHaveValue('歌手'); await dialog.getByRole('button', { name: '关闭歌手管理' }).click();
  const word = page.getByRole('textbox', { name: '词 学校', exact: true }); await word.click(); await page.keyboard.press('End'); await page.keyboard.type('|'); await page.keyboard.press('Enter');
  const draft = page.getByLabel('新增读音 学校'); await expect(draft).toBeFocused();
  await draft.dispatchEvent('compositionstart'); await draft.fill('かな'); await draft.press('Enter'); await expect(draft).toBeVisible(); await expect(page.locator('[data-ruby-id]')).toHaveCount(4);
  await draft.dispatchEvent('compositionend'); await draft.press('Escape'); await expect(draft).toHaveCount(0);
  await page.getByRole('button', { name: '撤销', exact: true }).click(); // Name edit.
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await page.locator('[data-top-menu="lyrics-settings"] summary').click(); await page.getByRole('button', { name: '歌手管理', exact: true }).click();
  await expect(dialog.getByRole('textbox', { name: '歌手 singer', exact: true })).toHaveCount(0);
});
