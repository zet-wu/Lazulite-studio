import { expect, test } from '@playwright/test';
import { importLyrics } from '../../fixtures/import-lyrics';

test('project configuration survives actual save and reopen, with one undo and clean lyric export', async ({ page }) => {
 await page.goto('/projects/background-playback/edit');
 await importLyrics(page, { name: 'config.ttml', mimeType: 'application/xml', buffer: Buffer.from('<tt xmlns="http://www.w3.org/ns/ttml" xmlns:studio="urn:lazulite:studio:draft"><body><p xml:id="a" begin="1" end="3"><span studio:id="word-a" begin="1" end="2">A</span></p><p xml:id="b" begin="3" end="4"><span studio:id="word-b" begin="3" end="4">B</span></p></body></tt>') });
 await page.getByRole('button', { name: '打轴', exact: true }).click();
 const word = page.locator('main [data-word-id="word-a"]');
 await word.click({ button: 'right' }); await page.getByRole('menuitem', { name: '添加空拍', exact: true }).click();
 await expect(word.locator('[data-sync-marker="beat"]')).toHaveCount(1);
 await page.getByRole('button', { name: '撤销', exact: true }).click(); await expect(word.locator('[data-sync-marker="beat"]')).toHaveCount(0);
 await page.getByRole('button', { name: '重做', exact: true }).click();
 await page.locator('[data-outline-drag]').first().click(); await page.getByLabel('跳过打轴', { exact: true }).check();
 await page.getByRole('button', { name: '保存', exact: true }).click(); await expect(page.getByText('已保存', { exact: true })).toBeVisible();
 const url='/api/v1/projects/background-playback/document';
 const before = await page.request.get(url), envelope=await before.json();
 expect(envelope.document.editing.emptyBeats).toEqual({ 'word-a': { kind:'word', count:1 } });
 expect(envelope.document.editing.ignoredSyncLineIds).toEqual(['a']);
 expect(envelope.document.lyrics.draftTtml).not.toMatch(/emptyBeat|ignoreSync|endLink/);
 envelope.document.editing.endLinks={a:'b'};
 const saved=await page.request.put(url,{ data:{schema_version:envelope.schema_version,project_id:envelope.project_id,revision:envelope.revision,document:envelope.document}, headers:{origin:'http://127.0.0.1:5175','if-match':before.headers().etag} });
 expect(saved.status(),await saved.text()).toBe(200);
 await page.reload(); await page.getByRole('button', { name: '打轴', exact: true }).click();
 await expect(word.locator('[data-sync-marker="beat"]')).toHaveCount(1);
 await expect(page.getByLabel('此行跳过打轴')).toBeVisible();
 const reopened=await (await page.request.get(url)).json(); expect(reopened.document.editing).toEqual(envelope.document.editing);
});
