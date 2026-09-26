import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const fixture = '../docs/evidence/editor-e0/reference-apple-metadata.ttml';
async function upload(page: import('@playwright/test').Page) {
  await page.goto('/editor');
  const source = await readFile(fixture);
  await page.locator('input[type="file"]').setInputFiles({ name: 'sample.ttml', mimeType: 'application/xml', buffer: source });
  await expect(page.getByRole('textbox', { name: '词 今日', exact: true })).toBeVisible();
}

test('imports, edits, undoes and downloads Ruby with background vocals', async ({ page }) => {
  await upload(page);
  await page.setViewportSize({ width: 390, height: 844 });
  const word = page.getByRole('textbox', { name: '词 今日', exact: true });
  await word.dblclick();
  await word.fill('今日改');
  await word.blur();
  await expect(page.getByRole('textbox', { name: '词 今日改', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '撤销' }).click();
  await expect(page.getByRole('textbox', { name: '词 今日', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '重做' }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载草稿' }).click();
  const xml = await readFile(await (await download).path(), 'utf8');
  expect(xml).toContain('今日改');
  expect(xml).toContain('きょ');
  expect(xml).toContain('響く');
  expect(xml).toContain('今天 也唱歌');
});

test('edits Ruby above its base with Backspace merge, F8 split and the trailing bar shortcut', async ({ page }) => {
  await upload(page);
  const word = page.locator('[data-line-id="L1"] [data-word-id]').first();
  const rubies = word.getByRole('textbox', { name: '读音 今日', exact: true });
  const rubyBox = await word.locator('[data-ruby-id]').first().boundingBox();
  const baseBox = await word.getByRole('textbox', { name: '词 今日', exact: true }).boundingBox();
  expect(rubyBox!.y).toBeLessThan(baseBox!.y);
  await rubies.nth(1).focus();
  await rubies.nth(1).press('Home');
  await rubies.nth(1).press('Backspace');
  await expect(rubies).toHaveCount(1);
  await expect(rubies.first()).toHaveValue('きょう');
  await page.getByRole('button', { name: '撤销' }).click();
  await expect(rubies).toHaveCount(2);
  await rubies.nth(1).focus();
  await rubies.nth(1).press('Home');
  await rubies.nth(1).press('Backspace');
  await rubies.first().evaluate((input: HTMLInputElement) => input.setSelectionRange(2, 2));
  await rubies.first().press('F8');
  await expect(rubies).toHaveCount(2);
  await word.getByRole('button', { name: '重分配读音时间' }).click();
  await expect(word.getByRole('textbox', { name: '读音 きょ结束秒数' })).toHaveValue('1.5');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '../docs/evidence/editor-e4/studio-ruby-390.png' });

  const plain = page.getByRole('textbox', { name: '词  も歌う', exact: true });
  await plain.dblclick();
  await plain.fill(' も歌う|');
  await plain.blur();
  const add = page.getByRole('textbox', { name: '新增读音  も歌う' });
  await expect(add).toBeVisible();
  await add.fill('もうたう');
  await add.press('Enter');
  await expect(page.locator('[data-line-id="L1"]').getByRole('textbox', { name: '读音  も歌う', exact: true })).toHaveValue('もうたう');
});

test('creates one Ruby base from selected adjacent words and restores them with undo', async ({ page }) => {
  await page.goto('/editor');
  const xml = '<tt xmlns="http://www.w3.org/ns/ttml"><body><div><p xml:id="plain" begin="1" end="2"><span begin="1" end="1.5">今</span><span begin="1.5" end="2">日</span></p></div></body></tt>';
  await page.locator('input[type="file"]').setInputFiles({ name: 'plain.ttml', mimeType: 'application/xml', buffer: Buffer.from(xml) });
  const line = page.locator('[data-line-id="plain"]');
  await line.getByRole('textbox', { name: '词 今', exact: true }).focus();
  await line.locator('[data-word-id]').nth(1).click({ modifiers: ['Control'] });
  await page.getByRole('button', { name: '合并为 Ruby base…' }).click();
  await expect(page.getByRole('dialog', { name: '整体 Ruby' })).toContainText('base：今日');
  await page.getByRole('textbox', { name: '读音' }).fill('きょう');
  await page.getByRole('button', { name: '应用（一次撤销）' }).click();
  await expect(line.locator('[data-word-id]')).toHaveCount(1);
  await expect(line.getByRole('textbox', { name: '读音 今日', exact: true })).toHaveValue('きょう');
  await page.getByRole('button', { name: '撤销' }).click();
  await expect(line.locator('[data-word-id]')).toHaveCount(2);
  await expect(line.getByRole('textbox', { name: '词 今', exact: true })).toBeVisible();
});

test('previews manual boundaries and auto segmentation, then undoes each application', async ({ page }) => {
  await upload(page);
  const firstLine = page.locator('[data-line-id="L1"]');
  await firstLine.getByRole('textbox', { name: '词  も歌う', exact: true }).focus();
  await page.getByRole('button', { name: '分词…' }).click();
  await page.getByRole('button', { name: '切分边界 2' }).click();
  await page.getByRole('button', { name: '生成预览' }).click();
  await expect(page.getByRole('dialog', { name: '分词' })).toContainText(' も │ 歌う');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '../docs/evidence/editor-e3/studio-manual-390.png' });
  await page.getByRole('button', { name: '应用（一次撤销）' }).click();
  await expect(firstLine.getByRole('textbox', { name: '词  も', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '撤销' }).click();
  await expect(firstLine.getByRole('textbox', { name: '词  も歌う', exact: true })).toBeVisible();

  await page.getByRole('button', { name: '分词…' }).click();
  await page.getByRole('button', { name: '自动' }).click();
  await page.getByRole('button', { name: '生成预览' }).click();
  await expect(page.getByRole('dialog', { name: '分词' })).toContainText('含 Ruby 或附属属性，保留原词');
  await page.getByRole('button', { name: '应用（一次撤销）' }).click();
  await expect(firstLine.getByRole('textbox', { name: '词  も', exact: true })).toBeVisible();
  await expect(firstLine.getByRole('textbox', { name: '词 今日', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '撤销' }).click();
  await page.getByRole('button', { name: '分词…' }).click();
  await page.getByRole('button', { name: '高级' }).click();
  await page.getByRole('textbox', { name: '忽略列表（每行一个）' }).fill('今日');
  await page.getByRole('textbox', { name: '自定义规则（每行 原文=部分|部分）' }).fill('も歌う=も|歌う');
  await page.getByRole('button', { name: '生成预览' }).click();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: '../docs/evidence/editor-e3/studio-advanced-1440.png' });
});

test('shifts current line and background together, then links and restores its end', async ({ page }) => {
  await upload(page);
  await page.getByRole('button', { name: '批处理…' }).click();
  await page.getByRole('button', { name: '时间偏移' }).click();
  await page.getByRole('spinbutton', { name: '偏移毫秒（负数为提前）' }).fill('100');
  await page.getByRole('button', { name: '应用（一次撤销）' }).click();
  await expect(page.getByRole('textbox', { name: '行 L1开始秒数' })).toHaveValue('1.1');
  await expect(page.getByRole('textbox', { name: '行 L1:bg开始秒数' })).toHaveValue('1.6');
  await page.getByRole('button', { name: '撤销' }).click();
  await expect(page.getByRole('textbox', { name: '行 L1开始秒数' })).toHaveValue('1');
  await page.getByRole('button', { name: '批处理…' }).click();
  await page.getByRole('button', { name: '结束时间链接' }).click();
  await page.getByRole('button', { name: '应用（一次撤销）' }).click();
  await expect(page.getByRole('dialog', { name: '批处理' })).toContainText('当前行链接到 L2');
  await page.getByRole('button', { name: '取消链接' }).click();
  await expect(page.getByRole('dialog', { name: '批处理' })).toContainText('已取消链接并恢复原结束时间');
});

test('saves the semantic checkpoint and restores undo history', async ({ page }) => {
  await upload(page);
  const word = page.getByRole('textbox', { name: '词 今日', exact: true });
  await word.dblclick();
  await word.fill('检查点文字');
  await word.blur();
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByText('检查点已保存')).toBeVisible();
  page.once('dialog', (dialog) => dialog.accept());
  await page.reload();
  await expect(page.getByText('恢复的草稿.ttml')).toBeVisible();
  await expect(page.getByRole('textbox', { name: '词 检查点文字', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '撤销' }).click();
  await expect(page.getByRole('textbox', { name: '词 今日', exact: true })).toBeVisible();
});

test('new local document clears the previous checkpoint', async ({ page }) => {
  await upload(page);
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByText('检查点已保存')).toBeVisible();
  await page.getByRole('button', { name: '新建' }).click();
  await expect(page.getByText('未命名.ttml')).toBeVisible();
  let prompted = false;
  page.on('dialog', (dialog) => { prompted = true; void dialog.dismiss(); });
  await page.reload();
  await expect(page.getByText('未命名.ttml')).toBeVisible();
  expect(prompted).toBe(false);
});

test('reorders words and grouped background lines through buttons and keyboard with undo', async ({ page }) => {
  await upload(page);
  const firstLine = page.locator('[data-line-id="L1"]');
  await page.getByRole('textbox', { name: '词 今日', exact: true }).focus();
  await expect(firstLine.locator('[data-word-id]').first()).toHaveClass(/selectedWord/);
  await page.getByRole('button', { name: '词后移 今日' }).click();
  await expect(firstLine.locator('[data-word-id]').first().getByRole('textbox', { name: '词 も歌う', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '撤销' }).click();
  await expect(firstLine.locator('[data-word-id]').first().getByRole('textbox', { name: '词 今日', exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: '词 今日', exact: true }).press('Alt+ArrowRight');
  await expect(firstLine.locator('[data-word-id]').first().getByRole('textbox', { name: '词 も歌う', exact: true })).toBeVisible();
  await page.getByRole('button', { name: /行下移.*今日/ }).click();
  await expect(page.locator('[data-line-id]').first()).toHaveAttribute('data-line-id', 'L2');
  await expect(page.locator('[data-line-id]').last()).toHaveAttribute('data-line-id', 'L1:bg');
  await page.getByRole('button', { name: '撤销' }).click();
  await expect(page.locator('[data-line-id]').first()).toHaveAttribute('data-line-id', 'L1');
  await expect(firstLine.getByRole('textbox', { name: '读音 今日' }).first()).toHaveValue('きょ');
});

test('copies timed Ruby words and background line groups with one-step undo', async ({ page }) => {
  await upload(page);
  const firstLine = page.locator('[data-line-id="L1"]');
  await page.getByRole('textbox', { name: '词 今日', exact: true }).focus();
  await page.getByRole('button', { name: '复制', exact: true }).click();
  await page.getByRole('button', { name: '粘贴', exact: true }).click();
  await expect(firstLine.getByRole('textbox', { name: '词 今日', exact: true })).toHaveCount(2);
  await expect(firstLine.getByRole('textbox', { name: '读音 今日', exact: true })).toHaveCount(4);
  const ids = await firstLine.locator('[data-word-id]').evaluateAll((items) => items.map((item) => item.getAttribute('data-word-id')));
  expect(new Set(ids).size).toBe(ids.length);
  await page.getByRole('button', { name: '撤销' }).click();
  await expect(firstLine.getByRole('textbox', { name: '词 今日', exact: true })).toHaveCount(1);

  await page.getByRole('button', { name: '1 今日 も歌う' }).click();
  await page.getByRole('button', { name: '复制', exact: true }).click();
  await page.getByRole('button', { name: '粘贴', exact: true }).click();
  await expect(page.locator('[data-line-id]')).toHaveCount(5);
  const copied = page.locator('[data-line-id]').nth(2);
  const copiedBackground = page.locator('[data-line-id]').nth(3);
  await expect(copied.getByRole('textbox', { name: '翻译 1' })).toHaveValue('今天 也唱歌');
  await expect(copiedBackground.getByRole('textbox', { name: '词 響く', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '撤销' }).click();
  await expect(page.locator('[data-line-id]')).toHaveCount(3);
});

test('selects a word range, cuts it once, and restores it with undo', async ({ page }) => {
  await upload(page);
  const firstLine = page.locator('[data-line-id="L1"]');
  await firstLine.getByRole('textbox', { name: '词 今日', exact: true }).focus();
  await firstLine.locator('[data-word-id]').nth(1).click({ modifiers: ['Control'] });
  await expect(page.getByText('词已选 2')).toBeVisible();
  await firstLine.locator('[data-word-id]').nth(1).click({ modifiers: ['Control'] });
  await expect(page.getByText('词已选 1')).toBeVisible();
  await firstLine.locator('[data-word-id]').nth(1).click({ modifiers: ['Shift'] });
  await expect(page.getByText('词已选 2')).toBeVisible();
  await page.getByRole('button', { name: '剪切', exact: true }).click();
  await expect(firstLine.locator('[data-word-id]')).toHaveCount(0);
  await page.getByRole('button', { name: '撤销' }).click();
  await expect(firstLine.locator('[data-word-id]')).toHaveCount(2);
  await page.getByRole('button', { name: '1 今日 も歌う' }).click();
  await page.getByRole('button', { name: '粘贴', exact: true }).click();
  await expect(firstLine.locator('[data-word-id]')).toHaveCount(4);
});

test('widens a destination line for a timed Ruby word moved across lines', async ({ page }) => {
  await upload(page);
  await page.getByRole('textbox', { name: '词 今日', exact: true }).focus();
  await page.getByRole('button', { name: '词移下行' }).click();
  const background = page.locator('[data-line-id="L1:bg"]');
  await expect(background.getByRole('textbox', { name: '词 今日', exact: true })).toBeVisible();
  await expect(background.getByRole('textbox', { name: '读音 今日', exact: true })).toHaveCount(2);
  await expect(page.getByRole('textbox', { name: '行 L1:bg开始秒数' })).toHaveValue('1');
  await page.getByRole('button', { name: '撤销' }).click();
  await expect(page.locator('[data-line-id="L1"]').getByRole('textbox', { name: '词 今日', exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: '行 L1:bg开始秒数' })).toHaveValue('1.5');
});

test('drags words and grouped lines to reorder, and Ctrl-drag copies a word', async ({ page }) => {
  await upload(page);
  await page.setViewportSize({ width: 1440, height: 1400 });
  const firstLine = page.locator('[data-line-id="L1"]');
  await page.getByRole('button', { name: /拖动词 今日/ }).dragTo(firstLine.locator('[data-word-id]').nth(1));
  await expect(firstLine.locator('[data-word-id]').first().getByRole('textbox', { name: '词 も歌う', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '撤销' }).click();
  await expect(firstLine.locator('[data-word-id]').first().getByRole('textbox', { name: '词 今日', exact: true })).toBeVisible();

  await page.keyboard.down('Control');
  await page.getByRole('button', { name: /拖动词 今日/ }).dragTo(firstLine.locator('[data-word-id]').nth(1));
  await page.keyboard.up('Control');
  await expect(firstLine.locator('[data-word-id]')).toHaveCount(3);
  await page.getByRole('button', { name: '撤销' }).click();
  await expect(firstLine.locator('[data-word-id]')).toHaveCount(2);

  await page.getByRole('button', { name: /拖动行 今日/ }).dragTo(page.locator('[data-line-id="L2"]'));
  await expect(page.locator('[data-line-id]').first()).toHaveAttribute('data-line-id', 'L2');
  await expect(page.locator('[data-line-id]').last()).toHaveAttribute('data-line-id', 'L1:bg');
  await page.getByRole('button', { name: '撤销' }).click();
  await expect(page.locator('[data-line-id]').first()).toHaveAttribute('data-line-id', 'L1');
  await page.keyboard.down('Control');
  await page.getByRole('button', { name: /拖动行 今日/ }).dragTo(page.locator('[data-line-id="L2"]'));
  await page.keyboard.up('Control');
  await expect(page.locator('[data-line-id]')).toHaveCount(5);
  await expect(page.locator('[data-line-id]').last().getByRole('textbox', { name: '词 響く', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '撤销' }).click();
  await expect(page.locator('[data-line-id]')).toHaveCount(3);
});

test('navigates between words and edits in simple and advanced layouts', async ({ page }) => {
  await upload(page);
  const first = page.getByRole('textbox', { name: '词 今日', exact: true });
  await first.focus();
  await first.press('Alt+ArrowDown');
  const second = page.getByRole('textbox', { name: '词 も歌う', exact: true });
  await expect(second).toBeFocused();
  await expect(second).toHaveAttribute('readonly', '');
  await second.dblclick();
  await second.fill('临时输入');
  await second.press('Escape');
  await expect(second).toHaveValue(' も歌う');
  await expect(page.getByRole('button', { name: '撤销' })).toBeDisabled();
  await second.focus();
  await second.press('Alt+ArrowDown');
  await expect(page.getByRole('textbox', { name: '词 響く', exact: true })).toBeFocused();
  await page.getByRole('button', { name: '简单布局' }).click();
  await expect(page.getByRole('heading', { name: '大纲' })).toBeHidden();
  await expect(page.getByRole('heading', { name: '属性' })).toBeHidden();
  await second.dblclick();
  await second.fill(' も歌うよ');
  await second.blur();
  await page.getByRole('button', { name: '撤销' }).click();
  await expect(page.getByRole('textbox', { name: '词 も歌う', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '高级布局' }).click();
  await expect(page.getByRole('heading', { name: '大纲' })).toBeVisible();
});

test('keyboard copy and paste retain Ruby across lines', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await upload(page);
  await page.locator('[data-line-id="L1"] [data-word-id]').first().focus();
  await page.keyboard.press('ControlOrMeta+C');
  await page.getByRole('button', { name: '3 宇宙' }).click();
  await page.locator('[data-line-id="L2"]').focus();
  await page.keyboard.press('ControlOrMeta+V');
  await expect(page.locator('[data-line-id="L2"]').getByRole('textbox', { name: '词 今日', exact: true })).toBeVisible();
  await expect(page.locator('[data-line-id="L2"]').getByRole('textbox', { name: '读音 今日', exact: true })).toHaveCount(2);
  await page.getByRole('button', { name: '撤销' }).click();
  await expect(page.locator('[data-line-id="L2"]').getByRole('textbox', { name: '词 今日', exact: true })).toHaveCount(0);
  await page.evaluate(() => navigator.clipboard.writeText('新行\n第二行'));
  await page.locator('[data-line-id="L2"]').focus();
  await page.keyboard.press('ControlOrMeta+V');
  await expect(page.locator('[data-line-id]')).toHaveCount(5);
  await expect(page.getByRole('textbox', { name: '词 新行', exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: '词 第二行', exact: true })).toBeVisible();
});

test('sorts from the outline and edits mixed line properties in one undo step', async ({ page }) => {
  await upload(page);
  await page.getByRole('button', { name: '1 今日 も歌う' }).click();
  await page.getByRole('button', { name: '3 宇宙' }).click({ modifiers: ['Control'] });
  await expect(page.getByText('行已选 2')).toBeVisible();
  const agents = page.getByRole('combobox', { name: '歌手' });
  await expect(agents).toHaveValue('__mixed__');
  await agents.selectOption('v1');
  await expect(agents).toHaveValue('v1');
  await page.getByRole('button', { name: '撤销' }).click();
  await expect(agents).toHaveValue('__mixed__');
  await page.getByRole('combobox', { name: '对唱' }).selectOption('true');
  await expect(page.getByRole('combobox', { name: '对唱' })).toHaveValue('true');
  await page.getByRole('button', { name: '撤销' }).click();
  await expect(page.getByRole('combobox', { name: '对唱' })).toHaveValue('__mixed__');
  await page.getByRole('button', { name: '大纲下移 今日 も歌う' }).click();
  await expect(page.locator('[data-line-id]').first()).toHaveAttribute('data-line-id', 'L2');
  await page.getByRole('button', { name: '撤销' }).click();
  await expect(page.locator('[data-line-id]').first()).toHaveAttribute('data-line-id', 'L1');
  await expect(page.locator('[data-line-id="L1"]').getByRole('textbox', { name: '读音 今日' }).first()).toHaveValue('きょ');
});

test('keeps 2000 variable-height lines virtual and locates the final line', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/editor');
  const body = Array.from({ length: 2000 }, (_, index) => {
    const words = Array.from({ length: 10 }, (_, word) => `<span>词${index}-${word} </span>`).join('');
    const translation = index % 2 ? '<span xmlns:ttm="http://www.w3.org/ns/ttml#metadata" ttm:role="x-translation">译文</span>' : '';
    return `<p itunes:key="L${index + 1}">${words}${translation}</p>`;
  }).join('');
  const xml = `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:itunes="http://music.apple.com/lyric-ttml-internal"><body><div>${body}</div></body></tt>`;
  await page.locator('input[type="file"]').setInputFiles({ name: 'long.ttml', mimeType: 'application/xml', buffer: Buffer.from(xml) });
  await expect(page.getByRole('button', { name: /2000 词1999-0/ })).toBeVisible();
  expect(await page.locator('[data-line-id]').count()).toBeLessThan(40);
  const heights = await page.locator('[data-line-id]').evaluateAll((items) => items.slice(0, 2).map((item) => item.getBoundingClientRect().height));
  expect(heights[0]).not.toBe(heights[1]);
  const firstInput = page.locator('[data-line-id="L1"] [data-word-id]').first().getByRole('textbox', { name: '词 词0-0', exact: true });
  await firstInput.dblclick();
  await firstInput.fill('保留草稿');
  await page.getByLabel('歌词列表').evaluate((list) => { list.scrollTop = list.scrollHeight; });
  await expect(page.locator('[data-line-id="L2000"]')).toBeVisible();
  await expect(firstInput).toHaveValue('保留草稿');
  await expect(firstInput).toBeFocused();
  await expect(page.getByRole('button', { name: '撤销' })).toBeDisabled();
  await page.getByRole('button', { name: /2000 词1999-0/ }).click();
  await expect(page.locator('[data-line-id="L2000"]')).toBeVisible();
  expect(await page.locator('[data-line-id]').count()).toBeLessThan(40);
  await expect(page.getByRole('button', { name: '撤销' })).toBeEnabled();
  await page.getByRole('button', { name: '撤销' }).click();
  await page.getByRole('button', { name: /^1 词0-0/ }).click();
  await expect(firstInput).toHaveValue('词0-0 ');
});

test('reorders a word with a touch drag handle', async ({ browser }) => {
  const context = await browser.newContext({ hasTouch: true, viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await upload(page);
  const firstLine = page.locator('[data-line-id="L1"]');
  const handle = page.getByRole('button', { name: '拖动词 今日' });
  const target = firstLine.locator('[data-word-id]').nth(1);
  await handle.scrollIntoViewIfNeeded();
  const from = (await handle.boundingBox())!;
  const to = (await target.boundingBox())!;
  const client = await context.newCDPSession(page);
  const start = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
  const end = { x: to.x + to.width / 2, y: to.y + to.height / 2 };
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] });
  for (let step = 1; step <= 5; step++) {
    await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: start.x + (end.x - start.x) * step / 5, y: start.y + (end.y - start.y) * step / 5 }] });
  }
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(firstLine.locator('[data-word-id]').first().getByRole('textbox', { name: '词 も歌う', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '撤销' }).click();
  await expect(firstLine.locator('[data-word-id]').first().getByRole('textbox', { name: '词 今日', exact: true })).toBeVisible();
  await context.close();
});

test('selects and cuts words across lines, then restores Ruby and timing with undo', async ({ page }) => {
  await upload(page);
  await page.locator('[data-line-id="L1"] [data-word-id]').first().focus();
  await page.locator('[data-line-id="L2"] [data-word-id]').first().click({ modifiers: ['Shift'] });
  await expect(page.getByText('词已选 4')).toBeVisible();
  await expect(page.locator('[data-line-id="L1"]')).toHaveClass(/selectedLine/);
  await expect(page.locator('[data-line-id="L2"]')).toHaveClass(/selectedLine/);
  await page.getByRole('button', { name: '复制', exact: true }).click();
  await page.getByRole('button', { name: '剪切', exact: true }).click();
  await expect(page.locator('[data-word-id]')).toHaveCount(0);
  await page.getByRole('button', { name: '撤销' }).click();
  await expect(page.locator('[data-word-id]')).toHaveCount(4);
  await page.getByRole('button', { name: '3 宇宙' }).click();
  await page.getByRole('button', { name: '粘贴', exact: true }).click();
  await expect(page.locator('[data-line-id="L2"] [data-word-id]')).toHaveCount(5);
  await expect(page.getByRole('textbox', { name: '行 L2开始秒数' })).toHaveValue('1');
  await expect(page.locator('[data-line-id="L2"]').getByRole('textbox', { name: '读音 今日' })).toHaveCount(2);
  await page.getByRole('button', { name: '撤销' }).click();
  await expect(page.locator('[data-line-id="L2"] [data-word-id]')).toHaveCount(1);
});

test('reports invalid inline time without losing the edit session', async ({ page }) => {
  await upload(page);
  const start = page.getByRole('textbox', { name: '词 今日开始秒数' });
  await start.fill('-1');
  await start.blur();
  await expect(page.getByRole('alert').filter({ hasText: '时间必须是非负秒数' })).toBeVisible();
  await expect(page.getByRole('button', { name: '撤销' })).toBeDisabled();
  await start.fill('1');
  await start.blur();
  await expect(page.getByText('时间必须是非负秒数')).toHaveCount(0);
  await expect(start).toHaveValue('1');
});

test('previews line romanization, generates timed Ruby, and undoes the batch', async ({ page }) => {
  await page.goto('/editor');
  const xml = '<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" xmlns:tts="http://www.w3.org/ns/ttml#styling"><body><p xml:id="L1" begin="0s" end="4s"><span begin="1s" end="2s">今日</span><span begin="2s" end="2.5s">も</span><span begin="2.5s" end="4s" tts:ruby="container"><span tts:ruby="base">宇宙</span><span tts:ruby="text"><span begin="2.5s" end="4s">そら</span></span></span><span ttm:role="x-roman">kyou mo sora</span></p></body></tt>';
  await page.locator('input[type="file"]').setInputFiles({ name: 'roman.ttml', mimeType: 'application/xml', buffer: Buffer.from(xml) });
  await page.getByRole('button', { name: '音译与 Ruby…' }).click();
  await page.getByRole('button', { name: '生成预览' }).click();
  const dialog = page.getByRole('dialog', { name: '音译与 Ruby' });
  await expect(dialog.getByRole('textbox', { name: '逐词音译 今日' })).toHaveValue('kyou');
  await expect(dialog.getByText('Ruby：きょ │ う')).toBeVisible();
  await expect(dialog.getByText('已有 Ruby：そら（保留）')).toBeVisible();
  await dialog.getByRole('button', { name: '应用（一次撤销）' }).click();
  await expect(page.locator('[data-line-id="L1"] [data-word-id]').first().getByRole('textbox', { name: '读音 今日' })).toHaveCount(2);
  await expect(page.getByRole('textbox', { name: '逐词音译 宇宙' })).toHaveValue('sora');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '最终 TTML' }).click();
  const exported = await readFile(await (await download).path(), 'utf8');
  expect(exported).toContain('transliterations');
  expect(exported).toContain('>kyou</span>');
  expect(exported).toContain('>sora</span>');
  await page.getByRole('button', { name: '撤销' }).click();
  await expect(page.locator('[data-line-id="L1"] [data-word-id]').first().getByRole('textbox', { name: '读音 今日' })).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: '逐词音译 宇宙' })).toHaveValue('');
  await page.locator('input[type="file"]').setInputFiles({ name: 'reopened.ttml', mimeType: 'application/xml', buffer: Buffer.from(exported) });
  await expect(page.getByRole('textbox', { name: '逐词音译 宇宙' })).toHaveValue('sora');
  await expect(page.locator('[data-line-id="L1"] [data-word-id]').first().getByRole('textbox', { name: '读音 今日' })).toHaveCount(2);
});

test('keeps IME composition active when Escape is pressed', async ({ page }) => {
  await upload(page);
  const word = page.getByRole('textbox', { name: '词 今日', exact: true });
  await word.dblclick();
  await word.dispatchEvent('compositionstart');
  await word.press('Escape');
  await expect(word).toBeFocused();
  await expect(word).not.toHaveAttribute('readonly', '');
  await word.dispatchEvent('compositionend');
  await word.press('Escape');
  await expect(word).toHaveAttribute('readonly', '');
  await expect(page.getByRole('button', { name: '撤销' })).toBeDisabled();
});
