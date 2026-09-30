import { expect, test, type Page } from '@playwright/test';
import { phase7Ttml } from '../fixtures/phase7';

async function generate(page: Page) {
  await page.locator('[data-outline-drag]').first().click({ button: 'right' });
  await page.getByRole('menuitem', { name: '生成日文罗马字音译…' }).click();
  return page.getByRole('dialog', { name: '生成日文罗马字音译', exact: true });
}

test('Local file mode survives reopening and reload, without sharing across filenames', async ({ page }) => {
  await page.goto('/editor');
  const load = (name: string) => page.locator('input[type=file]').setInputFiles({ name, mimeType: 'application/xml', buffer: Buffer.from(phase7Ttml) });
  await load('first.ttml'); let dialog = await generate(page);
  await expect(dialog.getByLabel('输出', { exact: true })).toHaveValue('plain');
  await dialog.getByLabel('输出', { exact: true }).selectOption('timed');
  await dialog.getByLabel('L1单元 1音译').fill('discarded');
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeDisabled();
  dialog = await generate(page);
  await expect(dialog.getByLabel('输出', { exact: true })).toHaveValue('timed');
  await expect(dialog.getByLabel('L1单元 1音译')).toHaveValue('ga ');
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await load('second.ttml'); dialog = await generate(page);
  await expect(dialog.getByLabel('输出', { exact: true })).toHaveValue('plain');
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await page.reload(); await load('first.ttml'); dialog = await generate(page);
  await expect(dialog.getByLabel('输出', { exact: true })).toHaveValue('timed');
  await dialog.getByLabel('输出', { exact: true }).selectOption('plain');
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  dialog = await generate(page);
  await expect(dialog.getByLabel('输出', { exact: true })).toHaveValue('plain');
});

test('First ja-Latn track is reused, populated lines stay skipped and new remains explicit', async ({ page }) => {
  await page.goto('/editor');
  const xml = await page.evaluate(async xml => {
    const path = '/src/adapters/ttml/lyric-codec.ts';
    const codec = await import(path) as typeof import('../../src/adapters/ttml/lyric-codec');
    const doc = codec.parseLyricTtml(xml);
    doc.romanizationTracks = [
      { id: 'english', language: 'en-Latn', contents: [] },
      { id: 'first-ja', language: 'ja-Latn', contents: [{ id: 'kept', lineId: doc.lines[1].id, kind: 'plain', text: 'keep me' }] },
      { id: 'second-ja', language: 'ja-Latn', contents: [] },
    ];
    return codec.serializeLyricTtml(doc, { draft: true });
  }, phase7Ttml);
  await page.locator('input[type=file]').setInputFiles({ name: 'tracks.ttml', mimeType: 'application/xml', buffer: Buffer.from(xml) });
  let dialog = await generate(page);
  await expect(dialog.getByLabel('目标轨道')).toHaveValue('first-ja');
  await expect(dialog.getByLabel('L1生成内容')).toHaveValue('append');
  await dialog.getByLabel('目标轨道').selectOption('second-ja');
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  dialog = await generate(page); await expect(dialog.getByLabel('目标轨道')).toHaveValue('first-ja');
  await dialog.getByLabel('L1音译', { exact: true }).fill('first manual');
  await dialog.getByRole('button', { name: '生成音译', exact: true }).click();
  await expect(page.getByLabel('音译 ja-Latn', { exact: true })).toHaveCount(2);
  await expect(page.getByLabel('音译 ja-Latn', { exact: true }).last()).toHaveValue('keep me');
  dialog = await generate(page);
  await expect(dialog.getByLabel('目标轨道')).toHaveValue('first-ja');
  await expect(dialog.getByLabel('L1生成内容')).toHaveValue('skip');
  await expect(dialog.getByRole('button', { name: '生成音译', exact: true })).toBeDisabled();
  await expect(dialog.getByLabel('目标轨道').locator('option')).toHaveCount(3);
  await dialog.getByLabel('目标轨道').selectOption('');
  await dialog.getByLabel('L1音译', { exact: true }).fill('new manual');
  await dialog.getByRole('button', { name: '生成音译', exact: true }).click();
  await expect(page.getByLabel('音译 ja-Latn', { exact: true })).toHaveCount(3);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(page.getByLabel('音译 ja-Latn', { exact: true })).toHaveCount(2);
  await expect(page.getByLabel('音译 ja-Latn', { exact: true }).first()).toHaveValue('first manual');
});
