import { expect, test } from '@playwright/test';
import { importLyrics } from '../fixtures/import-lyrics';
const ttml = `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:tts="http://www.w3.org/ns/ttml#styling" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" xmlns:studio="urn:lazulite:studio:draft" xml:space="preserve"><body><div><p xml:id="a" begin="0" end="9"><span studio:id="A" begin="1" end="2">A</span><span studio:id="space" begin="2" end="2.5">　</span><span studio:id="word" tts:ruby="container" begin="3" end="4"><span tts:ruby="base">今日</span><span tts:ruby="textContainer"><span studio:id="r1" tts:ruby="text" begin="3" end="3.5">きょ</span><span studio:id="r2" tts:ruby="text" begin="3.5" end="4">う</span></span></span><span studio:id="B" begin="5" end="6">B</span><span studio:id="bg" ttm:role="x-bg" begin="2" end="8"><span studio:id="BG" begin="2" end="8">背景</span></span></p><p xml:id="b" begin="10" end="20"><span studio:id="C" begin="10" end="20">C</span></p></div></body></tt>`;
async function load(page: import('@playwright/test').Page) {
  await page.goto('/projects/sample-project/edit');
  await importLyrics(page, { name: 'timing.ttml', mimeType: 'application/xml', buffer: Buffer.from(ttml) });
  await page.getByRole('button', { name: '打轴', exact: true }).click();
}
const word = (page: import('@playwright/test').Page, id: string) => page.locator(`main [data-word-id="${id}"]`);
const clock = (page: import('@playwright/test').Page, ms: number) => page.locator('audio').evaluate((audio: HTMLAudioElement, ms) => { audio.currentTime = ms / 1000; }, ms);
test('compact body/ruby bands keep whitespace, align dots, group background and share post-beat progress', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await load(page);
  await expect(page.locator('main input')).toHaveCount(0);
  await expect(word(page, 'space').locator('[data-sync-marker]')).toHaveCount(0);
  const a = word(page, 'A'); await a.click();
  for (let i = 0; i < 2; i++) { await a.click({ button: 'right' }); await page.getByRole('menuitem', { name: '添加空拍', exact: true }).click(); }
  await expect(a.locator('[data-sync-marker="beat"]')).toHaveCount(2);
  await clock(page, 1000); await page.getByRole('button', { name: '起始轴', exact: true }).click();
  for (let i = 1; i <= 2; i++) {
    await clock(page, 1000 + i * 250); await page.getByRole('button', { name: '连续轴', exact: true }).click();
    await expect(a.locator('[data-current]')).toHaveAttribute('data-sync-marker', 'beat');
    await expect(page.locator('[data-sync-marker][data-current]')).toHaveCount(1);
    await expect(page.getByLabel('选中对象结束秒数')).toHaveValue('2');
  }
  await clock(page, 1750); await page.getByRole('button', { name: '连续轴', exact: true }).click();
  await expect(page.locator('main [data-ruby-id="r1"] [data-sync-active]')).toHaveCount(1);
  await expect(page.getByLabel('选中对象开始秒数')).toHaveValue('1.75');
  const centers = await word(page, 'word').evaluate(node => {
    const readings = [...node.querySelectorAll('[data-ruby-id]')].map(el => el.getBoundingClientRect());
    const dots = [...node.querySelectorAll('[data-sync-marker="dot"]')].map(el => el.getBoundingClientRect());
    return readings.map((rect, i) => Math.abs((rect.left + rect.right - dots[i].left - dots[i].right) / 2));
  });
  expect(Math.max(...centers)).toBeLessThan(2);
  const rows = await page.locator('main [data-line-id]').evaluateAll(nodes => nodes.map(n => n.getAttribute('data-line-id')));
  expect(rows).toEqual(['a', 'bg', 'b']);
  await page.screenshot({ path: test.info().outputPath('compact-light.png') });
  await page.locator('[data-top-menu="view"] summary').click();
  await page.getByRole('button', { name: '夜间模式', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.screenshot({ path: test.info().outputPath('compact-dark.png') });
});
test('inline editing commits once, retains invalid input on mode switch, and cancels without history', async ({ page }) => {
  await load(page); const a = word(page, 'A');
  await a.dblclick(); const input = page.getByRole('textbox', { name: '词 A', exact: true }); await expect(input).toBeFocused();
  await input.fill('Alpha'); await input.press('Enter'); await expect(a).toContainText('Alpha'); await expect(a).toBeFocused();
  await page.getByRole('button', { name: '撤销', exact: true }).click(); await expect(a).toHaveText('A');
  await a.focus(); await a.press('F2'); await input.fill(''); await page.getByRole('button', { name: '编辑', exact: true }).click();
  await expect(input).toBeVisible(); await expect(input).toHaveAttribute('aria-invalid', 'true');
  await input.press('Escape'); await expect(page.locator('main input')).toHaveCount(0);
  await page.getByRole('button', { name: '编辑', exact: true }).click(); await expect(page.getByRole('textbox', { name: '词 A', exact: true })).toBeVisible();
});
test('multi-selection stamps active member, background is line-only and ignored line stays editable', async ({ page }) => {
  await load(page); await word(page, 'A').click(); await word(page, 'B').click({ modifiers: ['Control'] });
  await expect(page.locator('main [data-word-id][data-selected]')).toHaveCount(2);
  await clock(page, 4000); await page.getByRole('button', { name: '起始轴', exact: true }).click();
  await expect(page.getByRole('region', { name: '连续打轴' })).toContainText('B');
  await word(page, 'BG').click(); await expect(page.getByText('背景 · 本行', { exact: true })).toBeVisible();
  await clock(page, 3000); await page.getByRole('button', { name: '起始轴', exact: true }).click();
  await clock(page, 4000); await page.getByRole('button', { name: '结束轴', exact: true }).click();
  await expect(page.locator('[data-sync-marker][data-current]')).toHaveCount(0);
  await expect(page.getByText('本行已完成', { exact: true })).toHaveCount(0);
  await page.locator('main [data-line-id="bg"]').click({ position: { x: 3, y: 3 } });
  await page.getByLabel('跳过打轴', { exact: true }).check();
  await expect(page.getByLabel('此行跳过打轴')).toBeVisible();
  await word(page, 'BG').dblclick(); await expect(page.getByRole('textbox', { name: '词 背景' })).toBeFocused();
});
test('word/Ruby drafts, keyboard beat menus and ignored background persist through undo', async ({ page }) => {
  await load(page);
  const a = word(page, 'A'); await a.click({ button: 'right' }); await page.getByRole('menuitem', { name: '后插词', exact: true }).click();
  const draft = page.getByRole('textbox', { name: '添加词', exact: true }); await expect(draft).toBeFocused();
  await draft.fill(' '); await draft.press('Enter'); await expect(page.locator('main [data-word-id]')).toHaveCount(7);
  await expect(page.locator('main [data-sync-marker="dot"]')).toHaveCount(6);
  await page.getByRole('button', { name: '撤销', exact: true }).click(); await expect(page.locator('main [data-word-id]')).toHaveCount(6);
  await a.click({ button: 'right' }); await page.getByRole('menuitem', { name: '添加空拍', exact: true }).click();
  const beat = a.getByRole('button', { name: '后置空拍 1', exact: true }); await beat.focus(); await page.keyboard.press('Shift+F10');
  await page.getByRole('menuitem', { name: '增加空拍', exact: true }).click(); await expect(a.locator('[data-beat-owner]')).toHaveCount(2);
  const ruby = page.locator('main [data-ruby-id="r1"]'); await ruby.click({ button: 'right' }); await page.getByRole('menuitem', { name: '添加读音', exact: true }).click();
  const reading = page.getByRole('textbox', { name: '新增读音 今日', exact: true }); await expect(reading).toBeFocused(); await reading.fill('  '); await reading.press('Enter'); await expect(page.locator('main [data-ruby-id]')).toHaveCount(2);
  await ruby.click({ button: 'right' }); await page.getByRole('menuitem', { name: '添加读音', exact: true }).click();
  await reading.fill('と'); await reading.press('Enter'); await expect(page.locator('main [data-ruby-id]')).toHaveCount(3);
  await expect(page.locator('main [data-sync-marker="dot"]')).toHaveCount(7);
});
for (const count of [80, 81]) test(`return locates exact active object and restores no-target scroll at ${count} rows`, async ({ page }) => {
  const { performanceTtml } = await import('../fixtures/phase3');
  await page.goto('/projects/sample-project/edit?scenario=no-music'); await page.emulateMedia({ reducedMotion: 'reduce' });
  await importLyrics(page, { name: 'large.ttml', mimeType: 'application/xml', buffer: Buffer.from(performanceTtml(count)) });
  await page.locator('[data-outline-drag]').nth(count - 3).click();
  const row = page.locator(`main [data-line-id="p${count - 3}"]`); await expect(row).toBeVisible();
  const target = row.locator('[data-word-id]').last(); await target.click({ position: { x: 2, y: 2 } });
  const id = await target.getAttribute('data-word-id');
  await page.getByRole('button', { name: '音频处理', exact: true }).click();
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  const object = page.locator(`main [data-word-id="${id}"]`); await expect(object).toBeInViewport();
  await expect(page.getByRole('button', { name: '编辑', exact: true })).toBeFocused();
  await expect(page.locator('[data-outline-drag][aria-pressed="true"]')).toHaveCount(0);
  await expect(page.locator(`[data-active-context][data-line-id="p${count - 3}"]`)).toHaveCount(1);
  await page.getByRole('button', { name: '打轴', exact: true }).click(); await expect(page.locator(`main [data-word-id="${id}"]`)).toBeInViewport();
  if (count > 80) expect(await page.locator('main [data-line-id]').count()).toBeLessThan(30);
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  await page.locator('main').focus(); await page.keyboard.press('Escape');
  const scroller = page.getByLabel('歌词列表', { exact: true });
  await scroller.evaluate(el => { el.scrollTop = 400; });
  await page.waitForTimeout(100);
  const offset = await scroller.evaluate(el => el.scrollTop);
  await page.getByRole('button', { name: '音频处理', exact: true }).click();
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  await expect.poll(() => scroller.evaluate(el => el.scrollTop)).toBe(offset);

});

test('32 beats remain operable through narrow wrapping and the upper bound is disabled', async ({ page }) => {
 await load(page); await page.setViewportSize({ width: 1280, height: 900 });
 const ruby = page.locator('main [data-ruby-id="r1"]');
 for (let i=0;i<32;i++) { await ruby.click({button:'right'}); await page.getByRole('menuitem',{name:'添加空拍',exact:true}).click(); }
 await expect(page.locator('[data-beat-owner="r1"]')).toHaveCount(32);
 await ruby.click({button:'right'}); await expect(page.getByRole('menuitem',{name:'添加空拍',exact:true})).toBeDisabled(); await page.keyboard.press('Escape');
 const second = page.locator('main [data-ruby-id="r2"]');
 for (let i=0;i<32;i++) { await second.click({button:'right'}); await page.getByRole('menuitem',{name:'添加空拍',exact:true}).click(); }
 const scroller=page.getByLabel('歌词列表',{exact:true});
 expect(await scroller.evaluate(el=>el.scrollWidth-el.clientWidth)).toBeLessThanOrEqual(1);
 await page.locator('[data-beat-owner="r1"]').last().click({button:'right'}); await page.getByRole('menuitem',{name:'减少空拍',exact:true}).click();
 await expect(page.locator('[data-beat-owner="r1"]')).toHaveCount(31);
});
