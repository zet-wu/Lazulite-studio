import { expect, test, type Page } from '@playwright/test';
import { importLyrics } from '../fixtures/import-lyrics';

async function open(page: Page, count = 3, source = 'ka', body = 'は', setup: 'normal' | 'untimed' | 'overwrite' | 'link' = 'normal') {
  await page.goto('/projects/sample-project/edit?scenario=no-music');
  const xml = await page.evaluate(async ({ count, source, body, setup }) => {
    const domainPath = '/src/domain/lyric-document.ts'; const domain = await import(domainPath);
    const codecPath = '/src/adapters/ttml/lyric-codec.ts'; const codec = await import(codecPath);
    const doc = domain.createLyricDocument('歌');
    const line = doc.lines[0]; line.id = 'main'; line.beginMs = 0; line.endMs = count * 1000;
    line.words = Array.from({ length: count }, (_, i) => ({ ...domain.createWord(body, `w${i}`), beginMs: i * 1000, endMs: (i + 1) * 1000 }));
    doc.romanizationTracks = [{ id: 't', language: 'ja-Latn', contents: [{ id: 'c', lineId: line.id, kind: 'timed',
      units: Array.from({ length: count }, (_, i) => ({ id: `u${i}`, text: source, beginMs: i * 1000, endMs: (i + 1) * 1000 })) }] }];
    if (setup === 'untimed') doc.romanizationTracks[0].contents[0].units.forEach((unit: any) => { unit.beginMs = null; unit.endMs = null; });
    if (setup === 'overwrite') line.words[0].rubyUnits = [{ id: 'old', reading: 'は', beginMs: 0, endMs: 1000 }];
    if (setup === 'link') {
      const next = domain.createLyricDocument('次').lines[0]; next.id = 'next'; next.beginMs = count * 1000;
      next.endMs = (count + 1) * 1000; Object.assign(next.words[0], { beginMs: next.beginMs, endMs: next.endMs });
      doc.lines.push(next);
      doc.romanizationTracks[0].contents[0].units.at(-1).endMs += 1;
    }
    return codec.serializeLyricTtml(doc, { draft: true });
  }, { count, source, body, setup });
  await importLyrics(page, { name: 'reverse.ttml', mimeType: 'application/xml', buffer: Buffer.from(xml) });
  if (setup === 'link') {
    await page.locator('[data-outline-drag]').first().click();
    await page.locator('[data-top-menu="tools"] summary').click();
    await page.getByRole('button', { name: '批处理…', exact: true }).click();
    const batch = page.getByRole('dialog', { name: '批处理', exact: true });
    await batch.getByRole('button', { name: '结束时间链接', exact: true }).click();
    await batch.getByRole('button', { name: '应用（一次撤销）', exact: true }).click();
    await batch.getByRole('button', { name: '关闭', exact: true }).click();
  }
  await page.locator('[data-top-menu="tools"] summary').click();
  await page.getByRole('button', { name: '从音译生成 注音…', exact: true }).click();
  return page.getByRole('dialog', { name: '从音译生成 注音', exact: true });
}

test(`compact warning, correction, skip, direct navigation and Esc`, async ({ page }) => {
  const dialog = await open(page);

  const patrol = dialog.getByRole('button', { name: '下一处错误／警告' });
  const rows = dialog.locator('[data-ruby-row]');
  const readings = rows.getByLabel('目标 注音');
  await expect(dialog.getByRole('button', { name: '生成 注音', exact: true })).toBeEnabled();
  await expect(readings.first()).not.toHaveAttribute('aria-invalid');
  await patrol.click(); await expect(readings.nth(0)).toBeFocused();
  await expect(dialog.getByRole('tooltip')).toContainText('读音不同');
  await readings.nth(0).press('Escape');
  await expect(dialog).toBeVisible(); await expect(dialog.getByRole('tooltip')).toHaveCount(0);
  await readings.nth(0).fill('は');
  await patrol.click(); await expect(readings.nth(1)).toBeFocused();
  await rows.nth(1).getByLabel('跳过生成').check();
  await patrol.click(); await expect(readings.nth(2)).toBeFocused();
  await patrol.click(); await expect(readings.nth(2)).toBeFocused();
  await rows.nth(1).getByLabel('跳过生成').uncheck();
  await dialog.getByRole('button', { name: /核对 · L1/ }).first().click();
  await expect(readings.nth(1)).toBeFocused();
  await patrol.click(); await expect(readings.nth(2)).toBeFocused();
  await rows.nth(0).locator('[data-ruby-source]').hover();
  await expect(dialog.getByRole('tooltip')).toContainText('0s – 1s');
  const heights = await rows.evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().height));
  expect(Math.max(...heights)).toBeLessThan(85);
});

test('virtual patrol navigates between distant repeated sources', async ({ page }) => {
  test.setTimeout(90_000);
  const dialog = await open(page, 2000);
  const issues = dialog.getByRole('button', { name: /核对 · L1/ });
  await issues.nth(1990).click();
  const row = dialog.locator('[data-ruby-row="c:u1990"]'), input = row.getByLabel('目标 注音');
  await expect(input).toBeFocused(); await expect(input).toBeInViewport();
  await dialog.getByRole('button', { name: '下一处错误／警告' }).click();
  await expect(dialog.locator('[data-ruby-row="c:u1991"]').getByLabel('目标 注音')).toBeFocused();
  await expect(dialog.getByRole('button', { name: '下一处错误／警告' })).toBeInViewport();
});

test('invalid readings recover after manual edits, output resets patrol and punctuation empties proposal', async ({ page }) => {
  const dialog = await open(page, 2, '★', '字');
  const rows = dialog.locator('[data-ruby-row]');
  await expect(dialog.getByRole('button', { name: '生成 注音', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: '下一处错误／警告' }).click();
  await expect(rows.first().getByLabel('目标 注音')).toBeFocused();
  await rows.first().getByLabel('目标 注音').fill('じ');
  await expect(rows.first().getByLabel('目标 注音')).not.toHaveAttribute('aria-invalid');
  await rows.last().getByLabel('跳过生成').check();
  await expect(dialog.getByRole('button', { name: '生成 注音', exact: true })).toBeEnabled();
  await expect(dialog.getByRole('button', { name: '下一处错误／警告' })).toBeDisabled();
  await dialog.getByLabel('字符输出').selectOption('roman');
  await expect(rows.first().getByLabel('目标 注音')).toHaveValue('★');
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  const empty = await open(page, 2, '，。…', '字');
  await expect(empty).toContainText('没有可生成的音译单元');
  await expect(empty.getByRole('button', { name: '生成 注音', exact: true })).toBeDisabled();
});

test('target and overwrite navigation focus real controls, links stay blocked', async ({ page }) => {
  let dialog = await open(page, 2, 'ka', '字', 'untimed');
  const patrol = dialog.getByRole('button', { name: '下一处错误／警告' });
  await patrol.click();
  await expect(dialog.getByLabel('目标词').first()).toBeFocused();
  await dialog.getByLabel('目标词').first().selectOption('w1');
  await expect(dialog.getByLabel('目标 注音').first()).toHaveValue('か');
  await patrol.click(); await expect(dialog.getByLabel('目标词').last()).toBeFocused();
  await dialog.getByLabel('目标词').last().selectOption('w0');
  await expect(dialog.getByRole('button', { name: '生成 注音', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  dialog = await open(page, 2, 'ka', '字', 'overwrite');
  await dialog.getByRole('button', { name: /阻塞.*显式选择覆盖/ }).click();
  await expect(dialog.getByRole('checkbox', { name: /覆盖/ })).toBeFocused();
  await dialog.getByRole('checkbox', { name: /覆盖/ }).check();
  await expect(dialog.getByRole('button', { name: '生成 注音', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  dialog = await open(page, 2, 'ka', '字', 'link');
  await dialog.getByRole('button', { name: /阻塞.*行尾链接/ }).click();
  await expect(dialog.locator('[data-ruby-source]').first()).toBeFocused();
  await expect(dialog.getByRole('tooltip')).toContainText('请先处理链接');
  await expect(dialog.getByRole('button', { name: '生成 注音', exact: true })).toBeDisabled();
});

for (const count of [80, 81]) test(`virtualization boundary ${count} and output change reset巡查`, async ({ page }) => {
  const dialog = await open(page, count);
  const issues = dialog.getByRole('button', { name: /核对 · L1/ });
  await issues.last().click();
  await expect(dialog.locator(`[data-ruby-row="c:u${count - 1}"]`).getByLabel('目标 注音')).toBeFocused();
  await dialog.getByLabel('字符输出').selectOption('katakana');
  await dialog.getByRole('button', { name: '下一处错误／警告' }).click();
  await expect(dialog.locator('[data-ruby-row="c:u0"]').getByLabel('目标 注音')).toBeFocused();
});
