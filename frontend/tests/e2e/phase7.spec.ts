import { expect, test, type Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { phase6Ttml } from '../fixtures/phase6';
const xml = `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:tts="http://www.w3.org/ns/ttml#styling"><body><div>
<p xml:id="kana" begin="0" end="4"><span begin="0" end="4" tts:ruby="container"><span tts:ruby="base">学校</span><span tts:ruby="textContainer"><span tts:ruby="text" begin="0" end="1">が</span><span tts:ruby="text" begin="1" end="2">っ</span><span tts:ruby="text" begin="2" end="3">こ</span><span tts:ruby="text" begin="3" end="4">う</span></span></span></p>
<p xml:id="context" begin="4" end="6"><span begin="4" end="5">しん</span><span begin="5" end="6">よう</span></p>
<p xml:id="missing" begin="6" end="8"><span begin="6" end="8">漢字</span></p>
</div></body></tt>`;
async function load(page: Page, text = xml) {
  await page.goto('/editor');
  await page.locator('input[type=file]').setInputFiles({ name: 'phase7.ttml', mimeType: 'application/xml', buffer: Buffer.from(text) });
}
test('P7 Ruby generation is batch scoped, confirms context, repairs missing readings and undoes once', async ({ page }) => {
  await load(page);
  const outline = page.locator('[data-outline-drag]'); await expect(outline).toHaveCount(3);
  await outline.first().click(); await outline.last().click({ modifiers: ['Shift'] }); await outline.nth(1).click({ button: 'right' });
  await page.getByRole('menuitem', { name: '从 Ruby 生成音译…' }).click();
  const dialog = page.getByRole('dialog', { name: '从 Ruby 生成音译', exact: true });
  await expect(dialog).toContainText('生成 3 / 3 行');
  await expect(dialog.getByLabel('L1词组 1音译')).toHaveValue('gakkou');
  await expect(dialog.getByLabel('L2词组 1音译')).toHaveValue("shin'you");
  await expect(dialog.getByRole('button', { name: '生成音译', exact: true })).toBeDisabled();
  await dialog.getByLabel('确认跨词读音').check(); await dialog.getByLabel('L3词组 1读音').fill('かんじ');
  await dialog.getByLabel('输出', { exact: true }).selectOption('timed');
  await dialog.getByRole('button', { name: '生成音译', exact: true }).click();
  await expect(page.getByLabel('音译单元 1', { exact: true })).toHaveCount(3);
  await expect(page.getByLabel('读音 学校', { exact: true }).first()).toHaveValue('が');
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(page.getByLabel('音译单元 1', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '重做', exact: true }).click();
  await outline.first().click({ button: 'right' }); await page.getByRole('menuitem', { name: '从 Ruby 生成音译…' }).click();
  await dialog.getByLabel('目标轨道').selectOption({ label: '轨道 1 · ja-Latn' });
  await expect(dialog.getByLabel('L1生成内容')).toHaveValue('skip');
  await expect(dialog.getByRole('button', { name: '生成音译', exact: true })).toBeDisabled();
  await dialog.getByLabel('L1生成内容').selectOption({ label: '替换 · gakkou' });
  await dialog.getByLabel('L1词组 1音译').fill('edited');
  await dialog.getByRole('button', { name: '生成音译', exact: true }).click();
  await expect(page.getByLabel('音译 ja-Latn', { exact: true })).toHaveValue('edited');
  await expect(page.getByLabel('音译单元 1', { exact: true })).toHaveCount(2);
});
test('P7 split previews and assigns translations with cancellation and one undo', async ({ page }) => {
  await load(page, phase6Ttml());
  const outline = page.locator('[data-outline-drag]'); await outline.first().click({ button: 'right' });
  await page.getByRole('menuitem', { name: '拆分行…' }).click();
  const dialog = page.getByRole('dialog', { name: '拆分歌词行', exact: true });
  await expect(dialog.getByLabel('拆分结果').locator('section')).toHaveCount(2);
  await dialog.getByLabel('翻译 2归属').selectOption('right');
  await expect(dialog.getByLabel('拆分结果').locator('section').last()).toContainText('译文');
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeDisabled();
  await outline.first().click({ button: 'right' }); await page.getByRole('menuitem', { name: '拆分行…' }).click();
  await dialog.getByLabel('翻译 2归属').selectOption('right'); await dialog.getByRole('button', { name: '应用', exact: true }).click();
  await expect(outline).toHaveCount(4);
  const rows = page.locator('main section[data-line-id]');
  await expect(rows.nth(0).getByLabel('翻译 1', { exact: true })).toHaveValue('song');
  await expect(rows.nth(1).getByLabel('翻译 1', { exact: true })).toHaveValue('译文');
  await page.getByRole('button', { name: '撤销', exact: true }).click(); await expect(outline).toHaveCount(3);
});
for (const width of [1280, 1440, 1920]) for (const theme of ['light', 'dark']) test(`P7 translation autoheight and split result at ${width} ${theme}`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 }); await page.emulateMedia({ colorScheme: theme as 'light' | 'dark' }); await load(page, phase6Ttml());
  const text = page.locator('main section[data-line-id="english"]').getByLabel('翻译 1', { exact: true });
  const initial = (await text.boundingBox())!.height;
  await text.fill('很长的翻译内容 '.repeat(80));
  await expect.poll(async () => (await text.boundingBox())!.height).toBeGreaterThan(initial * 2);
  expect(await text.evaluate((e: HTMLTextAreaElement) => e.scrollHeight > e.clientHeight)).toBe(true);
  await text.fill('短'); await expect.poll(async () => (await text.boundingBox())!.height).toBe(initial);
  await text.press('Escape'); await expect(text).toHaveValue('song');
  await page.locator('[data-outline-drag]').first().click({ button: 'right' }); await page.getByRole('menuitem', { name: '拆分行…' }).click();
  await page.screenshot({ path: test.info().outputPath(`split-${width}-${theme}.png`) });
  const boxes = await page.getByLabel('拆分结果').locator('section').evaluateAll(nodes => nodes.map(e => ({ width: e.clientWidth, scroll: e.scrollWidth })));
  expect(boxes.every(box => box.scroll <= box.width)).toBe(true);
  await writeFile(test.info().outputPath('layout.json'), JSON.stringify({ width, theme, initial, boxes }));
});
