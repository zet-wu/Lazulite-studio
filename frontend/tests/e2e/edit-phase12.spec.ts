import { expect, test, type Page } from '@playwright/test';
import { importPhase12 } from '../fixtures/phase12';
const row = (page: Page) => page.locator('main section[data-line-id="p12-0"]');
const edge = async (page: Page, i: number, options = {}) => row(page).locator('[data-word-id]').nth(i).click({ position: { x: 3, y: 3 }, ...options });
test.beforeEach(async ({ page }) => { await page.goto('/editor'); await importPhase12(page); });

test('P12 reverse selection, mouse/keyboard menus, word and Ruby merge retain selection and focus', async ({ page }) => {
  await edge(page, 2); await edge(page, 0, { modifiers: ['Shift'] });
  await edge(page, 1, { button: 'right' });
  await expect(page.getByText('词已选 3', { exact: true })).toBeVisible();
  await page.getByRole('menuitem', { name: '合并', exact: true }).click();
  await expect(row(page).getByLabel('词 今日は', { exact: true })).toBeFocused();
  await expect(row(page).locator('[data-ruby-id]')).toHaveCount(2);
  const ruby = row(page).locator('[data-ruby-id]');
  await ruby.first().click({ position: { x: 3, y: 3 } });
  await ruby.last().click({ position: { x: 3, y: 3 }, modifiers: ['Shift'] });
  await ruby.last().press('Shift+F10');
  await expect(page.getByText('注音已选 2', { exact: true })).toBeVisible();
  await page.getByRole('menuitem', { name: '合并', exact: true }).click();
  await expect(row(page).getByLabel('读音 今日は', { exact: true })).toHaveValue('きょう');
  await expect(row(page).getByLabel('读音 今日は', { exact: true })).toBeFocused();
  await page.getByRole('button', { name: '撤销', exact: true }).click(); await expect(ruby).toHaveCount(2);
  await page.getByRole('button', { name: '撤销', exact: true }).click(); await expect(row(page).locator('[data-word-id]')).toHaveCount(4);
  await page.getByRole('button', { name: '重做', exact: true }).click(); await expect(row(page).locator('[data-word-id]')).toHaveCount(2);
});

test('P12 rejects noncontiguous and cross-word Ruby selections and right-click unselected switches to single', async ({ page }) => {
  await edge(page, 0); await edge(page, 2, { modifiers: ['Control'] }); await edge(page, 0, { button: 'right' });
  await expect(page.getByRole('menuitem', { name: /合并 ·.*连续/ })).toBeDisabled();
  await page.keyboard.press('Escape');
  await edge(page, 3, { button: 'right' }); await expect(page.getByRole('menuitem', { name: '合并前一词', exact: true })).toBeEnabled();
  await page.keyboard.press('Escape');
  const ruby = row(page).locator('[data-ruby-id]');
  await ruby.first().click({ position: { x: 3, y: 3 } }); await ruby.last().click({ position: { x: 3, y: 3 }, modifiers: ['Shift'] });
  await ruby.first().click({ position: { x: 3, y: 3 }, button: 'right' });
  await expect(page.getByRole('menuitem', { name: /合并 ·.*同一正文词/ })).toBeDisabled();
});

for (const entry of ['＋', '添加词', '前插词', '后插词']) test(`P12 ${entry} opens empty draft, commits once and focuses new text`, async ({ page }) => {
  if (entry === '＋') await row(page).getByRole('button', { name: '添加词', exact: true }).click();
  else {
    if (entry === '添加词') await page.locator('[data-outline-drag]').first().click({ button: 'right' });
    else await edge(page, entry === '前插词' ? 0 : 3, { button: 'right' });
    await page.getByRole('menuitem', { name: entry, exact: true }).click();
  }
  const draft = row(page).getByRole('textbox', { name: '添加词', exact: true });
  await expect(draft).toBeFocused(); await expect(draft).toHaveValue('');
  await expect(row(page).locator('[data-word-id]')).toHaveCount(4);
  await draft.fill('　 '); await draft.press('Enter');
  await expect(row(page).locator('[data-word-id]')).toHaveCount(5);
  const inserted = row(page).locator('[data-word-id]').nth(entry === '前插词' ? 0 : 4).locator('input[aria-label^="词 "]').first();
  await expect(inserted).toHaveValue('　 '); await expect(inserted).toBeFocused();
  await page.getByRole('button', { name: '撤销', exact: true }).click(); await expect(row(page).locator('[data-word-id]')).toHaveCount(4);
});

test('P12 three-way split preview, keyboard boundary, invalidated background, cancel and atomic apply', async ({ page }) => {
  const open = async () => { await page.locator('[data-outline-drag]').first().click({ button: 'right' }); await page.getByRole('menuitem', { name: '拆分行…' }).click(); };
  await open();
  const dialog = page.getByRole('dialog', { name: '拆分歌词行', exact: true });
  await expect(dialog.getByRole('button', { name: '应用', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: '在第 4 词前切分' }).click();
  await dialog.getByRole('button', { name: '在第 2 词前切分' }).focus(); await page.keyboard.press('Space');
  await expect(dialog.getByLabel('拆分结果').locator('section')).toHaveCount(3);
  await dialog.getByRole('button', { name: '在第 4 词前切分' }).click();
  await expect(dialog.getByRole('alert')).toContainText('重新选择');
  await dialog.getByLabel('背景歌词归属').selectOption({ label: '第 2 行' });
  await dialog.getByRole('button', { name: '取消', exact: true }).click(); await expect(page.locator('[data-outline-drag]')).toHaveCount(2);
  await open(); await dialog.getByRole('button', { name: '在第 2 词前切分' }).click(); await dialog.getByRole('button', { name: '在第 4 词前切分' }).click();
  await dialog.getByLabel('背景歌词归属').selectOption({ label: '第 3 行' });
  await dialog.getByLabel('翻译 1归属').selectOption({ label: '第 2 行' });
  await page.screenshot({ path: test.info().outputPath('split.png') });
  await dialog.getByRole('button', { name: '应用', exact: true }).click(); await expect(page.locator('[data-outline-drag]')).toHaveCount(4);
  await expect(page.locator('main section[data-line-id]').nth(1).getByLabel('翻译 1', { exact: true })).toHaveValue(' today ');
  await page.getByRole('button', { name: '撤销', exact: true }).click(); await expect(page.locator('[data-outline-drag]')).toHaveCount(2);
});

test('P12 empty and background drafts cancel, blur commits, IME waits, virtual outline mounts the draft', async ({ page }) => {
  const bg = page.locator('main section[data-line-id="bg"]');
  await bg.getByRole('button', { name: '添加词', exact: true }).click();
  let draft = bg.getByRole('textbox', { name: '添加词', exact: true });
  await draft.press('Escape'); await expect(bg.locator('[data-word-id]')).toHaveCount(2);
  await bg.getByRole('button', { name: '添加词', exact: true }).click();
  await draft.blur(); await expect(bg.locator('[data-word-id]')).toHaveCount(2);
  await bg.getByRole('button', { name: '添加词', exact: true }).click();
  await draft.dispatchEvent('compositionstart'); await draft.fill('新增'); await draft.press('Enter');
  await page.mouse.move(0, 0); await expect(draft).toHaveValue('新增');
  await expect(bg.locator('[data-word-id]')).toHaveCount(2);
  await draft.dispatchEvent('compositionend'); await draft.blur();
  await expect(bg.getByLabel('词 新增', { exact: true })).toBeFocused();
  await expect(bg.locator('[data-word-id]')).toHaveCount(3);
  await importPhase12(page, 120);
  await page.locator('[data-outline-drag]').last().click({ button: 'right' });
  await page.getByRole('menuitem', { name: '添加词', exact: true }).click();
  const last = page.locator('main section[data-line-id="p12-119"]');
  draft = last.getByRole('textbox', { name: '添加词', exact: true });
  await expect(draft).toBeFocused(); await draft.fill('末行'); await draft.press('Enter');
  await expect(last.getByLabel('词 末行', { exact: true })).toBeFocused();
  await page.getByRole('button', { name: '新增歌词行', exact: true }).click();
  const empty = page.locator('main section[data-line-id]').last();
  await empty.getByRole('button', { name: '添加词', exact: true }).click();
  await empty.getByRole('textbox', { name: '添加词', exact: true }).fill('空行新增');
  await empty.getByRole('textbox', { name: '添加词', exact: true }).press('Enter');
  await expect(empty.getByLabel('词 空行新增', { exact: true })).toBeFocused();
});

test('P12 three Ruby and background words use the same merge actions; insertion uses clicked anchor in multi-selection', async ({ page }) => {
  const { phase7Ttml } = await import('../fixtures/phase7');
  const { importLyrics } = await import('../fixtures/import-lyrics');
  await importLyrics(page, { name: 'ruby.ttml', mimeType: 'application/xml', buffer: Buffer.from(phase7Ttml) });
  const ruby = page.locator('main [data-ruby-id]');
  await ruby.nth(2).click({ position: { x: 3, y: 3 } }); await ruby.first().click({ position: { x: 3, y: 3 }, modifiers: ['Shift'] });
  await ruby.nth(1).click({ position: { x: 3, y: 3 }, button: 'right' }); await page.getByRole('menuitem', { name: '合并', exact: true }).click();
  await expect(ruby).toHaveCount(2); await expect(ruby.first().getByRole('textbox').first()).toHaveValue('がっこ');
  await importPhase12(page);
  const bg = page.locator('main section[data-line-id="bg"] [data-word-id]');
  await bg.first().click({ position: { x: 3, y: 3 } }); await bg.last().click({ position: { x: 3, y: 3 }, modifiers: ['Shift'] });
  await bg.first().click({ position: { x: 3, y: 3 }, button: 'right' }); await page.getByRole('menuitem', { name: '合并', exact: true }).click();
  await expect(page.getByLabel('词 背景', { exact: true })).toBeFocused();
  await edge(page, 0); await edge(page, 2, { modifiers: ['Shift'] }); await edge(page, 1, { button: 'right' });
  await page.getByRole('menuitem', { name: '后插词', exact: true }).click();
  await row(page).getByRole('textbox', { name: '添加词', exact: true }).fill('中间'); await page.keyboard.press('Enter');
  await expect(row(page).locator('[data-word-id]')).toHaveCount(5);
  await expect(row(page).locator('[data-word-id]').nth(2).getByLabel('词 中间', { exact: true })).toBeFocused();
});

for (const theme of ['light', 'dark'] as const) test(`P12 long line boundaries wrap in ${theme}`, async ({ page }) => {
  await page.emulateMedia({ colorScheme: theme });
  const { importLyrics } = await import('../fixtures/import-lyrics');
  const xml = `<tt xmlns="http://www.w3.org/ns/ttml"><body><div><p>${Array.from({ length: 80 }, (_, i) => `<span>长词${i}</span>`).join('')}</p></div></body></tt>`;
  await importLyrics(page, { name: 'long.ttml', mimeType: 'application/xml', buffer: Buffer.from(xml) });
  await page.locator('[data-outline-drag]').first().click({ button: 'right' }); await page.getByRole('menuitem', { name: '拆分行…' }).click();
  const dialog = page.getByRole('dialog', { name: '拆分歌词行', exact: true });
  const boundaries = dialog.getByLabel('拆行切点');
  expect(await boundaries.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  expect((await dialog.getByRole('button', { name: '在第 80 词前切分' }).boundingBox())!.y).toBeGreaterThan((await dialog.getByRole('button', { name: '在第 2 词前切分' }).boundingBox())!.y);
  await dialog.getByRole('button', { name: '在第 20 词前切分' }).click(); await dialog.getByRole('button', { name: '在第 60 词前切分' }).click();
  await expect(dialog.getByLabel('拆分结果').locator('section')).toHaveCount(3);
  await page.screenshot({ path: test.info().outputPath(`long-split-${theme}.png`) });
});

test('P12 split uses known word envelope across a 1ms punctuation reversal in preview and apply', async ({ page }) => {
  const { importLyrics } = await import('../fixtures/import-lyrics');
  const xml = '<tt xmlns="http://www.w3.org/ns/ttml"><body><div><p begin="73" end="78"><span begin="74.560" end="75.224">伝え</span><span begin="75.224" end="75.224">(</span><span begin="75.223" end="75.865">伝え)</span></p></div></body></tt>';
  await importLyrics(page, { name: 'boundary.ttml', mimeType: 'application/xml', buffer: Buffer.from(xml) });
  await page.locator('[data-outline-drag]').first().click({ button: 'right' }); await page.getByRole('menuitem', { name: '拆分行…' }).click();
  const dialog = page.getByRole('dialog', { name: '拆分歌词行', exact: true });
  await dialog.getByRole('button', { name: '在第 2 词前切分' }).click();
  await expect(dialog.getByLabel('拆分结果').locator('section').first()).toContainText('74.560s – 75.224s');
  await expect(dialog.getByLabel('拆分结果').locator('section').last()).toContainText('75.223s – 75.865s');
  await dialog.getByRole('button', { name: '应用', exact: true }).click();
  await expect(page.locator('[data-outline-drag]')).toHaveCount(2);
  await page.getByRole('button', { name: '撤销', exact: true }).click(); await expect(page.locator('[data-outline-drag]')).toHaveCount(1);
});
