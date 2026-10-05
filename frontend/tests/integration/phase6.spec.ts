import { importLyrics } from '../fixtures/import-lyrics';
import { expect, test } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { phase6Ttml } from '../fixtures/phase6';

test('P6 real FastAPI preserves translations, multiple singer order, source blanks and untimed inline additions through draft/final reopening', async ({ page }) => {
  await page.goto('/projects/phase4-background/edit');
  await importLyrics(page, { name: 'phase6.ttml', mimeType: 'application/xml', buffer: Buffer.from(phase6Ttml()) });
  const line = page.locator('main section[data-line-id="english"]');
  await expect(line.getByLabel('翻译 1', { exact: true })).toHaveValue('song');
  await line.getByRole('button', { name: '管理翻译轨道…' }).click();
  const manager = page.getByRole('dialog', { name: '翻译轨道管理' }); await manager.getByLabel('翻译轨道 1语言').fill('ja'); await manager.getByRole('button', { name: '应用', exact: true }).click();
  await line.getByRole('button', { name: '删除翻译', exact: true }).nth(1).click();
  await page.locator('[data-outline-drag]').nth(1).click();
  await page.getByLabel('歌手 主唱', { exact: true }).check();
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(page.getByLabel('歌手 主唱', { exact: true })).not.toBeChecked();
  await page.getByRole('button', { name: '重做', exact: true }).click();
  await line.getByRole('button', { name: '添加词', exact: true }).click();
  await line.getByRole('textbox', { name: '添加词', exact: true }).fill('追加'); await line.getByRole('textbox', { name: '添加词', exact: true }).press('Enter');
  await line.getByRole('button', { name: '添加词', exact: true }).click();
  await line.getByRole('textbox', { name: '添加词', exact: true }).fill('  '); await line.getByRole('textbox', { name: '添加词', exact: true }).press('Enter');
  await line.locator('[data-romanization-content-id]').first().locator('strong').click({ button: 'right' });
  await page.getByRole('menuitem', { name: '从音译生成 注音…' }).click();
  const dialog = page.getByRole('dialog', { name: '从音译生成 注音' });
  await expect(dialog.getByLabel('目标词')).toHaveCount(1); await dialog.getByLabel('字符输出').selectOption('roman');
  await dialog.getByRole('button', { name: '生成 注音', exact: true }).click();
  const put = page.waitForResponse(response => response.url().endsWith('/api/v1/projects/phase4-background/document') && response.request().method() === 'PUT');
  await page.getByRole('button', { name: '保存', exact: true }).click(); expect((await put).status()).toBe(200);
  await expect(page.getByText('已保存', { exact: true })).toBeVisible();
  const saved = await (await page.request.get('/api/v1/projects/phase4-background/document')).json();
  await page.reload();
  await expect(line).toContainText('轨道 1 · ja · subtitle');
  await expect(line.getByRole('button', { name: '删除翻译', exact: true })).toHaveCount(1);
  await expect(line.getByLabel('词 追加开始秒数')).toHaveValue('');
  await expect(line.getByLabel('读音 I', { exact: true })).toHaveValue('ai');
  await expect(line.locator('[data-word-id]').last().locator('[class*="wordMain"] input')).toHaveValue('  ');
  const semantic = await page.evaluate(async xml => {
    const path = '/src/adapters/ttml/lyric-codec.ts'; const codec = await import(path) as typeof import('../../src/adapters/ttml/lyric-codec');
    const document = codec.parseLyricTtml(xml);
    return { agents: document.lines.map(line => line.agentRefs), translations: document.translationTracks.flatMap(track => track.contents.filter(content => content.lineId === document.lines[0].id).map(({ lineId: _lineId, ...content }) => ({ ...content, language: track.language, purpose: track.purpose }))), appended: document.lines[0].words.slice(-2).map(word => ({ text: word.text, beginMs: word.beginMs, endMs: word.endMs })), units: document.romanizationTracks[0].contents[0] };
  }, saved.document.lyrics.draftTtml);
  expect(semantic.agents.slice(0, 2)).toEqual([['v1', 'v2'], ['v2', 'v1']]);
  expect(semantic.translations).toMatchObject([{ purpose: 'subtitle' as const, kind: 'plain' as const,  text: 'song', language: 'ja' }]);
  expect(semantic.appended).toEqual([{ text: '追加', beginMs: null, endMs: null }, { text: '  ', beginMs: null, endMs: null }]);
  expect(semantic.units).toMatchObject({ kind: 'timed', units: [{ text: 'ai', beginMs: 1000 }, { text: '', beginMs: 0, endMs: 6000 }, { text: '  ', beginMs: 0, endMs: 6000 }] });
  await page.getByRole('button', { name: '文件打包', exact: true }).click();
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: '下载歌词', exact: true }).click();
  const xml = await readFile(await (await download).path(), 'utf8');
  await importLyrics(page, { name: 'final.ttml', mimeType: 'application/xml', buffer: Buffer.from(xml) });
  await expect(line).toContainText('轨道 1 · ja · subtitle');
  await page.locator('[data-outline-drag]').nth(1).click();
  await expect(page.getByLabel('歌手 主唱', { exact: true })).toBeChecked();
  await expect(page.getByLabel('歌手 另一歌手', { exact: true })).toBeChecked();
  const refs = await page.evaluate(async xml => { const path = '/src/adapters/ttml/lyric-codec.ts'; return (await import(path)).parseLyricTtml(xml).lines.map((line: { agentRefs: string[] }) => line.agentRefs); }, xml);
  expect(refs.slice(0, 2)).toEqual([['v1', 'v2'], ['v2', 'v1']]);
  await expect(line.locator('[data-word-id]').last().locator('[class*="wordMain"] input')).toHaveValue('  ');
  await writeFile(test.info().outputPath('roundtrip.json'), JSON.stringify(semantic));
});

test('P6 original review I still love you keeps independent visible spaces after real save and AMLL toggles', async ({ page }) => {
  test.skip(!process.env.STUDIO_REVIEW_TTML, 'Provide the original review TTML explicitly.');
  const original = await readFile(process.env.STUDIO_REVIEW_TTML!, 'utf8');
  await page.goto('/projects/phase4-background/edit');
  await importLyrics(page, { name: 'review.ttml', mimeType: 'application/xml', buffer: Buffer.from(original) });
  await expect(page.locator('[data-outline-drag]')).toHaveCount(38);
  await page.getByRole('button', { name: '保存', exact: true }).click(); await expect(page.getByText('已保存', { exact: true })).toBeVisible();
  await page.reload();
  const saved = await (await page.request.get('/api/v1/projects/phase4-background/document')).json();
  // The fixture media is only 132s; scrub the actual saved document with the local preview clock.
  await page.goto('/editor');
  await importLyrics(page, { name: 'saved-original.ttml', mimeType: 'application/xml', buffer: Buffer.from(saved.document.lyrics.draftTtml) });
  await page.getByRole('button', { name: '预览', exact: true }).click();
  await page.getByRole('slider', { name: '试听位置', exact: true }).evaluate((element: HTMLInputElement) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, '223000');
    element.dispatchEvent(new Event('input', { bubbles: true })); element.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const player = page.locator('.amll-lyric-player'); await expect(player).toContainText('I still love you');
  const verify = async () => {
    const measure = () => player.evaluate(e => {
      const line = [...e.querySelectorAll('div')].filter(node => node.textContent?.includes('I still love you') && [...node.childNodes].filter(child => child.nodeType === Node.TEXT_NODE && child.textContent === ' ').length === 3)[0];
      if (!line) return null;
      return [...line.childNodes].filter(child => child.nodeType === Node.TEXT_NODE && child.textContent === ' ').map(node => { const range = document.createRange(); range.selectNode(node); return range.getBoundingClientRect().width; });
    });
    await expect.poll(async () => (await measure())?.filter(width => width > 0).length).toBe(3);
    return measure();
  };
  const metrics = await verify();
  await page.screenshot({ path: test.info().outputPath('original-preview-spaces.png') });
  await page.getByRole('checkbox', { name: '音译', exact: true }).uncheck(); await page.getByRole('checkbox', { name: '翻译', exact: true }).uncheck(); await verify();
  await writeFile(test.info().outputPath('original-spaces.json'), JSON.stringify({ metrics, readonlySource: process.env.STUDIO_REVIEW_TTML }));
});
