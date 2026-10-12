import { expect, test } from '@playwright/test';

test('generates 注音, saves through FastAPI and reopens the complete current draft', async ({ page }) => {
  await page.goto('/projects/multitrack-project/edit');
  const line = page.locator('main section[data-line-id="line-a"]');
  await expect(line.getByRole('textbox', { name: '词 二人', exact: true })).toBeVisible();
  const content = line.locator('[data-romanization-content-id]').first();
  const source = await content.locator('input').evaluateAll((items) => items.map((item) => (item as HTMLInputElement).value));
  await content.getByText('音译 · ja-Latn').click({ button: 'right' });
  await page.getByRole('menuitem', { name: '从音译生成 注音…' }).click();
  const dialog = page.getByRole('dialog', { name: '从音译生成 注音' });
  await expect(dialog.getByLabel('确认同时扩展上述词/行时间')).toHaveCount(0);
  await dialog.getByRole('button', { name: '生成 注音', exact: true }).click();
  await expect(line.getByRole('textbox', { name: '读音 二人', exact: true })).toHaveCount(3);
  const savedResponse = page.waitForResponse((response) => response.url().endsWith('/api/v1/projects/multitrack-project/document') && response.request().method() === 'PUT');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  expect((await savedResponse).status()).toBe(200);
  await expect(page.getByText('已保存', { exact: true })).toBeVisible();
  const saved = await (await page.request.get('/api/v1/projects/multitrack-project/document')).json();
  expect(saved.document.lyrics.draftTtml).toContain('urn:lazulite:studio:draft');
  await page.reload();
  await expect(line.getByRole('textbox', { name: '读音 二人', exact: true })).toHaveCount(3);
  expect(await line.getByRole('textbox', { name: '读音 二人', exact: true }).evaluateAll((items) => items.map((item) => (item as HTMLInputElement).value))).toEqual(['ふ', 'た', 'り']);
  await expect(line.locator('[data-romanization-content-id]')).toHaveCount(3);
  expect(await content.locator('input').evaluateAll((items) => items.map((item) => (item as HTMLInputElement).value))).toEqual(source);
  await page.locator('[data-line-id="line-a"] [data-outline-drag]').click();
  await expect(page.getByRole('textbox', { name: '行 line-a开始秒数' })).toHaveValue('0.999');
  const reopened = await (await page.request.get('/api/v1/projects/multitrack-project/document')).json();
  expect(reopened.revision).toBe(saved.revision);
  expect(reopened.document.lyrics.draftTtml).toBe(saved.document.lyrics.draftTtml);
});

test('reopens a saved incomplete Ruby outside its line and retains the original endpoints', async ({ page }) => {
  const created=await page.request.post('/api/v1/projects',{headers:{origin:'http://127.0.0.1:5175'},data:{name:'incomplete Ruby'}});const pid=(await created.json()).id;
  const url=`/api/v1/projects/${pid}/document`;
  const before=await(await page.request.get(url)).json();
  const xml='<tt xmlns="http://www.w3.org/ns/ttml" xmlns:tts="http://www.w3.org/ns/ttml#styling" xmlns:studio="urn:lazulite:studio:draft"><body><p xml:id="line-a" begin="1" end="2"><span studio:id="word" begin="1" end="2" tts:ruby="container"><span tts:ruby="base">傍</span><span tts:ruby="textContainer"><span tts:ruby="text" studio:id="ruby" begin="5" studio:null="end">そ</span></span></span></p></body></tt>';
  const document={...before.document,karaoke:{...before.document.karaoke,lineGroups:{'line-a':'main'},cues:[]},lyrics:{draftTtml:xml},lineOrder:[],editing:{emptyBeats:{},ignoredSyncLineIds:[],skippedAlignmentLineIds:[],endLinks:{}}};
  const saved=await page.request.put(url,{headers:{origin:'http://127.0.0.1:5175','if-match':before.revision},data:{schema_version:before.schema_version,project_id:pid,revision:before.revision,document}});
  expect(saved.ok()).toBeTruthy();
  await page.goto(`/projects/${pid}/edit`);
  await page.getByRole('button',{name:'编辑',exact:true}).click();
  await expect(page.getByRole('textbox',{name:'词 傍',exact:true})).toBeVisible();
  await page.reload();
  await expect(page.getByRole('textbox',{name:'词 傍',exact:true})).toBeVisible();
  expect((await(await page.request.get(url)).json()).revision).toBe((await saved.json()).revision);
});
