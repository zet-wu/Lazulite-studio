import { expect, test, type Page } from '@playwright/test';
import { importLyrics } from '../fixtures/import-lyrics';

async function load(page: Page) {
  await page.goto('/projects/sample-project/edit?scenario=no-music');
  const xml = await page.evaluate(async () => {
    const path = '/src/domain/lyric-document.ts', codec = '/src/adapters/ttml/lyric-codec.ts';
    const { createLyricDocument, createLine } = await import(path) as typeof import('../../src/domain/lyric-document');
    const { serializeLyricTtml } = await import(codec) as typeof import('../../src/adapters/ttml/lyric-codec');
    const d = createLyricDocument();
    d.lines = Array.from({ length: 31 }, (_, i) => ({ ...createLine(i === 0 ? ' é👨‍👩‍👧‍👦🇨🇳字正文全文' : i === 1 ? '短句' : '相同前缀歌词' + i + (i === 29 ? '长正文'.repeat(60) : ''), `l${i}`), beginMs: i * 1000, endMs: (i + 1) * 1000, backgroundOf: i === 1 ? 'l0' : null }));
    d.translationTracks = Array.from({ length: 30 }, (_, i) => ({ id: `t${i}`, language: 'en', purpose: i === 0 ? 'replacement' : 'subtitle', contents: [{ id: `c${i}`, lineId: `l${i}`, kind: 'plain', text: i === 0 ? ' é👨‍👩‍👧‍👦🇨🇳字翻译全文 ' : i === 1 ? '短译' : '相同翻译前缀' + i + (i === 29 ? '长翻译'.repeat(60) : '') }] }));
    d.translationTracks[0].contents.push({ id: 'extra', lineId: 'l30', kind: 'plain', text: '第31份内容' });
    d.translationTracks.push({ id: 'empty', language: null, purpose: 'subtitle', contents: [] });
    return serializeLyricTtml(d, { draft: true });
  });
  await importLyrics(page, { name: 'editor-content-transfer.ttml', mimeType: 'application/xml', buffer: Buffer.from(xml) });
}
async function manage(page: Page) {
  await page.locator('[data-top-menu=lyrics-settings] summary').click();
  await page.getByRole('button', { name: '管理翻译轨道', exact: true }).first().click();
  return page.getByRole('dialog', { name: '翻译轨道管理', exact: true });
}
test(`keyboard mixed selection and scoped transfer`, async ({ page }) => {

  await load(page); let dialog = await manage(page);
  const first = dialog.getByRole('checkbox', { name: '选择翻译轨道 1 · L1 · 内容 1', exact: true });
  await first.press('Space');
  const global = dialog.getByRole('checkbox', { name: '全选内容', exact: true });
  const local = dialog.getByRole('checkbox', { name: '全选本轨内容', exact: true }).first();
  for (const input of [global, local]) { await expect(input).toHaveAttribute('aria-checked', 'mixed'); expect(await input.evaluate((el: HTMLInputElement) => el.indeterminate)).toBe(true); }
  await local.press('Space'); await expect(local).toBeChecked(); await local.press('Space'); await expect(local).not.toBeChecked();
  await global.press('Space'); await expect(global).toBeChecked();
  await expect(dialog.getByRole('checkbox', { name: '选择翻译轨道 30 · L29 · 内容 1', exact: true })).toBeChecked();
  await expect(dialog.getByRole('checkbox', { name: '全选本轨内容', exact: true }).last()).toBeDisabled();
  await dialog.getByLabel('翻译归轨目标').selectOption('t0');
  await expect(dialog).toContainText('已选择 31 份内容；实际转入 29 份，将移除 29 条');
  await first.focus();
  await dialog.getByRole('button', { name: '转入目标轨道', exact: true }).click();
  await expect(dialog.getByRole('checkbox', { name: '全选本轨内容', exact: true })).toHaveCount(2);
  await dialog.getByRole('button', { name: '应用', exact: true }).click();
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  dialog = await manage(page); await expect(dialog.getByRole('checkbox', { name: '全选本轨内容', exact: true })).toHaveCount(31);
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: '重做', exact: true }).click();
  dialog = await manage(page); await expect(dialog.getByRole('checkbox', { name: '全选本轨内容', exact: true })).toHaveCount(2);
  const moved = dialog.getByRole('checkbox', { name: '选择翻译轨道 1 · L29 · 内容 31', exact: true }); await moved.hover();
  await expect(moved.locator('..').locator('[id="translation-reference-c29"]')).toBeVisible();
  await expect(moved.locator('..')).toContainText('长正文'.repeat(60));

  await dialog.getByRole('button', { name: '取消', exact: true }).click();
});

test('deletion clears the target, cancellation discards it, application is one undoable transaction', async ({ page }) => {
  await load(page); let dialog = await manage(page);
  await dialog.getByLabel('翻译归轨目标').selectOption('t0');
  await dialog.getByRole('checkbox', { name: '全选内容', exact: true }).check();
  await dialog.getByRole('button', { name: '删除轨道及 2 份内容（轨道 1）', exact: true }).click();
  await expect(dialog.getByLabel('翻译归轨目标')).toHaveValue('');
  await expect(dialog).toContainText('已选择 29 份内容');
  await expect(dialog.getByRole('button', { name: '转入目标轨道', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  dialog = await manage(page); await expect(dialog.getByRole('checkbox', { name: '选择翻译轨道 1 · L1 · 内容 1', exact: true })).toHaveCount(1);
  await dialog.getByRole('button', { name: '删除轨道及 2 份内容（轨道 1）', exact: true }).click();
  await dialog.getByRole('button', { name: '应用', exact: true }).click();
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  dialog = await manage(page); await expect(dialog.getByRole('checkbox', { name: '选择翻译轨道 1 · L1 · 内容 1', exact: true })).toHaveCount(1);
  await dialog.getByRole('button', { name: '取消', exact: true }).click(); await page.getByRole('button', { name: '重做', exact: true }).click();
  dialog = await manage(page); await expect(dialog.getByRole('checkbox', { name: '选择翻译轨道 1 · L1 · 内容 1', exact: true })).toHaveCount(0);
});
