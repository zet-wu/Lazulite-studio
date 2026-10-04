import { expect, test, type Page } from '@playwright/test';
import { importLyrics } from '../fixtures/import-lyrics';
import { phase7Ttml } from '../fixtures/phase7';
async function generate(page: Page) {
  await page.locator('[data-outline-drag]').first().click({ button: 'right' });
  await page.getByRole('menuitem', { name: '生成日文罗马字音译…' }).click();
  return page.getByRole('dialog', { name: '生成日文罗马字音译', exact: true });
}
for (const width of [1280, 1440, 1920]) for (const theme of ['light', 'dark']) test(`outline selection and quoted romanization ${width} ${theme}`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await page.addInitScript(theme => localStorage.setItem('lazulite-editor-theme', theme), theme);
  await page.goto('/editor');
  await importLyrics(page, { name: 'phase3.ttml', mimeType: 'application/xml', buffer: Buffer.from(phase7Ttml) });
  const rows = page.locator('[data-outline-drag]');
  await rows.first().click(); await rows.nth(1).click({ modifiers: ['Control'] });
  await expect(rows.nth(0)).toHaveAttribute('aria-pressed', 'true'); await expect(rows.nth(1)).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '撤销', exact: true }).focus();
  const colors = await rows.evaluateAll(els => els.map(e => ({ bg: getComputedStyle(e).backgroundColor, border: getComputedStyle(e).borderTopWidth, mark: getComputedStyle(e).boxShadow })));
  expect(colors[0].bg).toBe(colors[1].bg); expect(colors[0].bg).not.toBe(colors[2].bg);
  expect(colors.every(c => c.border === '0px')).toBe(true); expect(colors[0].mark).not.toBe('none');
  await page.getByRole('button', { name: '打轴', exact: true }).click();
  for (const select of await page.locator('select:visible').all()) expect(await select.evaluate(e => getComputedStyle(e).backgroundImage)).toBe('none');
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  await rows.first().press('Escape'); await rows.first().click(); let dialog = await generate(page);
  await expect(dialog.getByLabel('输出', { exact: true })).toHaveValue('timed');
  const target = dialog.getByLabel('L1生成内容');
  const label = await target.locator('..').locator('..').boundingBox(), box = await target.boundingBox();
  expect(label!.height).toBeLessThan(box!.height + 8);
  await dialog.getByRole('button', { name: '生成音译', exact: true }).click();
  dialog = await generate(page);
  const select = dialog.getByLabel('L1生成内容');
  const replace = await select.locator('option').last().getAttribute('value');
  await select.selectOption(replace!);
  await expect(dialog.locator('.studio-select-value .studio-lyric-quote')).toHaveText('ga k ko u');
  await select.click();
  const option = dialog.getByRole('listbox').getByRole('option', { name: '替换 · ga k ko u' });
  await expect(option).toBeVisible();
  expect(await option.locator('.studio-lyric-quote').evaluate(e => getComputedStyle(e).fontWeight)).toBe('600');
  await page.screenshot({ path: test.info().outputPath('romanization.png') });
  await page.keyboard.press('Escape'); await dialog.getByRole('button', { name: '取消', exact: true }).click();
});
test('four sources keep many long candidates inside scrolling rows and actions stationary', async ({ page }) => {
  await page.setViewportSize({ width:1280, height:650 }); await page.goto('/editor');
  await page.getByRole('button', { name: '歌词获取', exact: true }).waitFor();
  await page.evaluate(() => {
    const original = window.fetch;
    window.fetch = async (input, init) => {
      const url = String(input), body = JSON.parse(String(init?.body ?? '{}'));
      if (url.endsWith('/lyric-sources/search')) return Response.json({ items: Array.from({length:25}, (_,i) => ({source:body.source,id:String(i),songmid:String(i),title:`${body.source} ${i} `+'LongTitle'.repeat(12),artists:['Artist'.repeat(15)],album:'Album'.repeat(20),duration_ms:120000})) });
      if (url.endsWith('/lyric-sources/fetch')) return Response.json({empty:false,format:'qrc',content:'[1000,500]歌(1000,500)',metadata:{}});
      return original(input,init);
    };
  });
  await page.getByRole('button', { name: '歌词获取', exact: true }).click();
  await page.getByRole('tab',{name:'网易云音乐',exact:true}).click();
  await page.getByLabel('搜索标题').fill('Many'); await page.getByRole('button', { name:'搜索', exact:true }).click();
  const positions:number[]=[];
  for (const tab of ['网易云音乐','QQ 音乐','酷狗','AMLL DB']) {
    await page.getByRole('tab', {name:tab,exact:true}).click();
    const list=page.getByLabel('歌曲候选'); await expect(list.getByRole('button')).toHaveCount(25);
    expect(await list.evaluate(e=>e.scrollHeight>e.clientHeight)).toBe(true);
    expect(await list.getByRole('button').evaluateAll(els=>els.every(e=>e.scrollHeight<=e.clientHeight+2))).toBe(true);
    positions.push((await page.getByRole('button',{name:'仅关联歌曲 ID',exact:true}).boundingBox())!.y);
    await list.getByRole('button').last().scrollIntoViewIfNeeded();
    await expect(page.getByRole('button',{name:'仅关联歌曲 ID',exact:true})).toBeVisible();
  }
  expect(Math.max(...positions)-Math.min(...positions)).toBeLessThan(2);
  await page.screenshot({path:test.info().outputPath('candidates.png')});
});
