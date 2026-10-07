import { expect, test, type Page } from '@playwright/test';
import { importLyrics } from '../fixtures/import-lyrics';
import { loadTimeline } from '../fixtures/timeline-setup';
const xml = `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" xmlns:studio="urn:lazulite:studio:draft" xml:space="preserve"><head><metadata><iTunesMetadata xmlns="http://music.apple.com/lyric-ttml-internal"><translations><translation xml:lang="en" type="subtitle"><text for="a"> one </text><text for="b">two</text></translation><translation xml:lang="en" type="replacement"><text for="a">other</text></translation></translations></iTunesMetadata></metadata></head><body><p xml:id="a" begin="1" end="5"><span studio:id="w" begin="1" studio:null="end">は</span><span begin="3" end="5">ヘを</span></p><p xml:id="b" begin="6" studio:null="end"><span begin="6" end="8">次</span></p><p xml:id="c" begin="10" end="12">終</p></body></tt>`;
async function load(page: Page) { await page.goto('/editor'); await importLyrics(page, { name: 'phase8.ttml', mimeType: 'application/xml', buffer: Buffer.from(xml) }); }
async function manager(page: Page) { await page.locator('[data-top-menu=lyrics-settings] summary').click(); await page.getByRole('button', { name: '管理翻译轨道…', exact: true }).first().click(); return page.getByRole('dialog', { name: '翻译轨道管理', exact: true }); }

for (const theme of ['light', 'dark']) test(`track metadata, reorder and transfer preserve active text and undo in ${theme}`, async ({ page }) => {
  await page.addInitScript(theme => localStorage.setItem('lazulite-editor-theme', theme), theme);
  await load(page); const row = page.locator('main section[data-line-id="a"]');
  await row.getByLabel('翻译 1', { exact: true }).fill(' manual ');
  const dialog = await manager(page);
  await expect(dialog).toContainText(' manual ');
  await dialog.getByLabel('翻译轨道 1语言').fill('ja');
  await dialog.getByRole('button', { name: '下移翻译轨道 1', exact: true }).click();
  await dialog.getByRole('checkbox').last().check();
  await dialog.getByLabel('翻译归轨目标').selectOption({ label: '轨道 1 · en · replacement' });
  await dialog.getByRole('button', { name: '转入目标轨道', exact: true }).click();
  await page.screenshot({ path: test.info().outputPath(`translation-manager-${theme}.png`) });
  await dialog.getByRole('button', { name: '应用', exact: true }).click();
  await expect(row.getByLabel('翻译 1', { exact: true })).toHaveValue('other');
  await expect(row.getByLabel('翻译 2', { exact: true })).toHaveValue(' manual ');
  await expect(page.locator('main section[data-line-id="b"]')).toContainText('replacement');
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(row.getByLabel('翻译 1', { exact: true })).toHaveValue(' manual ');
  await expect(page.locator('main section[data-line-id="b"]')).toContainText('subtitle');
});
test('kana preference is global, keyboard accessible and survives manual generation edits', async ({ page }) => {
  await load(page); await page.locator('[data-top-menu=settings] summary').click();
  await page.getByRole('button', { name: '音译生成假名高亮', exact: true }).click();
  let settings = page.getByRole('dialog', { name: '音译生成假名高亮' });
  await expect(settings.getByLabel('假名集合')).toHaveValue('はへを');
  await settings.getByRole('button', { name: '清空', exact: true }).click();
  await settings.getByRole('button', { name: '恢复默认', exact: true }).click();
  await settings.getByLabel('假名集合').fill('ハ、へ'); await settings.getByRole('button', { name: '保存', exact: true }).click();
  await page.locator('[data-outline-drag]').first().click({ button: 'right' }); await page.getByRole('menuitem', { name: '生成日文罗马字音译…' }).click();
  const generation = page.getByRole('dialog', { name: '生成日文罗马字音译', exact: true });
  const input = generation.getByLabel('L1单元 1音译'); await input.fill('wa'); await input.focus();
  await expect(input).toHaveAttribute('aria-description', /源读音含 は/); await expect(input).toHaveValue('wa');
  await generation.getByLabel('输出', { exact: true }).selectOption('plain');
  await expect(generation.locator('[title*="源读音含"]')).toHaveCount(2);
  await generation.getByRole('button', { name: '取消', exact: true }).click();
  expect(await page.evaluate(() => localStorage.getItem('lazulite-kana-highlight'))).toBe('はへ');
});
test('explicit validation invalidates on edits and still permits TXT with missing timing', async ({ page }) => {
  await load(page); let downloads = 0; page.on('download', () => downloads++);
  await page.getByRole('button', { name: '文件打包', exact: true }).click();
  await expect(page.getByText('尚未执行歌词校验。')).toBeVisible();
  await page.getByRole('button', { name: '歌词校验', exact: true }).click();
  await expect(page.getByText(/已检查 TTML、TXT/)).toHaveCount(0); await expect(page.getByText(/有 \d+ 项需要处理/)).toBeVisible(); expect(downloads).toBe(0);
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  const text = page.locator('main section[data-line-id="a"]').getByLabel('翻译 1', { exact: true }); await text.fill('change'); await text.press('Enter');
  await page.getByRole('button', { name: '文件打包', exact: true }).click();
  await expect(page.getByText(/尚未执行歌词校验|文档已变化/)).toBeVisible();
  await page.getByLabel('导出格式').selectOption('txt'); const download = page.waitForEvent('download'); await page.getByRole('button', { name: '下载歌词', exact: true }).click(); await download;
});
test('temporary handle click and escape do not write, drag fills one side and undo restores null', async ({ page }) => {
  await loadTimeline(page); await importLyrics(page, { name: 'partial.ttml', mimeType: 'application/xml', buffer: Buffer.from(xml) });
  await page.getByLabel('吸附', { exact: true }).uncheck();
  const line = page.getByRole('button', { name: '时间轴行 L2', exact: true });
  await expect(line).toHaveAttribute('data-temporary-end', 'true'); await line.click();
  await expect(page.getByRole('button', { name: '循环选区', exact: true })).toBeDisabled();
  const handle = line.getByLabel('时间轴行 L2结束边界'), field = page.getByRole('textbox', { name: '行 b结束秒数', exact: true });
  await handle.click(); await expect(field).toHaveValue('');
  const body = (await line.boundingBox())!;
  await page.mouse.move(body.x + body.width / 2, body.y + body.height / 2); await page.mouse.down(); await page.mouse.move(body.x + body.width / 2 + 20, body.y + body.height / 2, { steps: 4 }); await page.mouse.up();
  await expect(field).toHaveValue(''); await expect(page.getByText('请先为行设置完整时间', { exact: true })).toBeVisible();
  const realHandle = (await line.getByLabel('时间轴行 L2开始边界').boundingBox())!;
  await page.mouse.move(realHandle.x + realHandle.width / 2, realHandle.y + realHandle.height / 2); await page.mouse.down(); await page.mouse.move(realHandle.x - 15, realHandle.y + realHandle.height / 2, { steps: 4 }); await page.mouse.up();
  await expect(field).toHaveValue(''); await expect(page.getByRole('textbox', { name: '行 b开始秒数', exact: true })).not.toHaveValue('6');
  await page.getByRole('button', { name: '撤销', exact: true }).click();

  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); await page.mouse.move(box.x + 20, box.y + box.height / 2, { steps: 4 }); await page.keyboard.press('Escape'); await page.mouse.up();
  await expect(field).toHaveValue('');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); await page.mouse.move(box.x + 20, box.y + box.height / 2, { steps: 4 }); await page.mouse.up();
  await expect(field).not.toHaveValue(''); await expect(line).not.toHaveAttribute('data-temporary-end');
  await page.getByRole('button', { name: '撤销', exact: true }).click(); await expect(field).toHaveValue(''); await expect(line).toHaveAttribute('data-temporary-end', 'true');
  await page.screenshot({ path: test.info().outputPath('temporary-end.png') });
});
for (const theme of ['light', 'dark']) test(`actual AMLL renders untimed quotes and zero punctuation with Ruby in ${theme}`, async ({ page }) => {
  await page.addInitScript(theme => localStorage.setItem('lazulite-editor-theme', theme), theme);
  await page.goto('/editor');
  const source = await page.evaluate(async () => {
    const path = '/src/domain/lyric-document.ts', codecPath = '/src/adapters/ttml/lyric-codec.ts';
    const { createLyricDocument, createWord } = await import(path) as typeof import('../../src/domain/lyric-document');
    const { serializeLyricTtml } = await import(codecPath) as typeof import('../../src/adapters/ttml/lyric-codec');
    const d = createLyricDocument(''); d.lines[0].beginMs = 1000; d.lines[0].endMs = 3000;
    d.lines[0].words = [createWord('「'), { ...createWord('字'), beginMs: 1000, endMs: 2500, rubyUnits: [{ id: 'r', reading: 'じ', beginMs: 1000, endMs: 2500 }] }, { ...createWord('！'), beginMs: 2500, endMs: 2500 }, createWord('」')];
    return serializeLyricTtml(d, { draft: true });
  });
  await importLyrics(page, { name: 'punctuation.ttml', mimeType: 'application/xml', buffer: Buffer.from(source) });
  await page.getByRole('button', { name: '预览', exact: true }).click();
  const player = page.locator('.amll-lyric-player'); await expect(player).toContainText('！'); await expect(player).toContainText('「'); await expect(player).toContainText('」'); await expect(player).toContainText('じ');
  for (const position of [1500, 2500, 2700]) {
    await page.getByRole('slider', { name: '试听位置', exact: true }).evaluate((element: HTMLInputElement, value) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, String(value));
      element.dispatchEvent(new Event('input', { bubbles: true })); element.dispatchEvent(new Event('change', { bubbles: true }));
    }, position);
    await expect(player).toContainText('！');
  }
  await expect.poll(() => player.evaluate(element => element.getAnimations({ subtree: true }).filter(animation => animation.id.startsWith('fade-word-')).some(animation => Number(animation.currentTime) >= 1500))).toBe(true);
  const geometry = await player.evaluate(element => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT); const result: Record<string, number[]> = {};
    while (walker.nextNode()) for (const char of ['「', '！', '」']) if (walker.currentNode.textContent?.includes(char)) { const range = document.createRange(); range.selectNode(walker.currentNode); (result[char] ??= []).push(range.getBoundingClientRect().width); }
    return result;
  });
  for (const char of ['「', '！', '」']) expect(geometry[char]?.some(width => width > 0)).toBe(true);
  await page.screenshot({ path: test.info().outputPath(`punctuation-${theme}.png`) });
});

for (const side of ['开始', '结束']) test(`background word temporary ${side} skips untimed separator words after clearing and undo`, async ({ page }) => {
  await loadTimeline(page);
  const source = `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" xmlns:studio="urn:lazulite:studio:draft" xml:space="preserve"><body><p xml:id="main" begin="1" end="8"><span begin="1" end="8">正文</span><span ttm:role="x-bg" studio:id="bg" begin="1" end="8"><span begin="2" end="3">scell</span><span studio:id="space-before" studio:null="begin end"> </span><span studio:id="gungnir" begin="3" end="4">gungnir</span><span studio:id="space-wide" studio:null="begin end">　</span><span studio:id="space-after" studio:null="begin end"> </span><span begin="4" end="8">tron)</span></span></p></body></tt>`;
  await importLyrics(page, { name: 'background-separators.ttml', mimeType: 'application/xml', buffer: Buffer.from(source) });
  await page.getByRole('button', { name: '时间轴行 L1 背景', exact: true }).click();
  const field = page.getByRole('textbox', { name: `词 gungnir${side}秒数`, exact: true });
  await field.fill(''); await field.press('Tab');
  const word = page.getByRole('button', { name: '时间轴词 gungnir', exact: true });
  await expect(word).toHaveAttribute('aria-description', `${side}未定，临时端点 ${side === '开始' ? 3000 : 4000} 毫秒，拖动该边界设置真实时间`);
  await expect(field).toHaveValue('');
  await word.click();
  await expect(page.getByRole('button', { name: '循环选区', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(field).toHaveValue(side === '开始' ? '3' : '4');
  await expect(word).not.toHaveAttribute(side === '开始' ? 'data-temporary-begin' : 'data-temporary-end');
});
