import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { importLyrics } from '../fixtures/import-lyrics';
import { xml } from '../fixtures/timeline-phase3';
async function create(page: Page) {
  await page.goto('/projects'); await page.getByRole('button',{name:'新建项目',exact:true}).click();
  await page.getByLabel('项目名称',{exact:true}).fill('无音乐第四轮'); await page.getByRole('button',{name:'创建项目',exact:true}).click();
  await page.waitForURL(/\/projects\/[^/]+\/edit/);return page.url().split('/projects/')[1].split('/')[0];
}
async function save(page: Page) {await page.getByRole('button',{name:'保存',exact:true}).click();await expect(page.getByText('已保存',{exact:true})).toBeVisible();}
async function envelope(page: Page,id:string) {return (await page.request.get(`/api/v1/projects/${id}/document`)).json();}
const file={name:'phase4.ttml',mimeType:'application/xml',buffer:Buffer.from(xml.replace('<p xml:id="empty"/>',''))};
test('no music: import, shared beat properties, translation, metadata, undo and reopen',async({page})=>{
  await page.setViewportSize({width:1440,height:1000});const id=await create(page);
  await expect(page.getByRole('button',{name:'歌词获取',exact:true})).toHaveAttribute('aria-current','page');
  await importLyrics(page,file);await expect(page.getByLabel('词 Alpha空拍数')).toHaveCount(0);
  await page.getByRole('button',{name:'打轴',exact:true}).click();await page.locator('main [data-word-id="A"]').click();
  const beats=page.getByLabel('后置空拍',{exact:true});await beats.fill('33');await beats.press('Enter');await expect(page.getByRole('alert')).toContainText('0–32');
  await beats.fill('3');await beats.press('Escape');await expect(beats).toHaveValue('0');await beats.fill('2');await beats.press('Enter');
  await expect(page.locator('main [data-word-id="A"] [data-sync-marker="beat"]')).toHaveCount(2);
  await page.locator('main [data-word-id="W"] [class*="syncBody"]').click();await expect(beats).toHaveCount(0);
  await page.locator('main [data-ruby-id="r1"]').click();await beats.fill('1');await beats.press('Enter');
  await expect(page.getByRole('button',{name:'起始轴',exact:true})).toBeDisabled();await page.getByRole('button',{name:'编辑',exact:true}).click();
  const line=page.locator('main [data-line-id="a"]');await line.getByRole('button',{name:'新增翻译',exact:true}).click();
  await line.getByLabel('翻译 1',{exact:true}).fill('草稿');await line.getByLabel('翻译 1',{exact:true}).press('Escape');await save(page);
  expect((await envelope(page,id)).document.lyrics.draftTtml).not.toContain('translation');
  await line.getByRole('button',{name:'新增翻译',exact:true}).click();await line.getByLabel('翻译 1',{exact:true}).fill('译文');await line.getByLabel('翻译 1',{exact:true}).press('Enter');
  await page.getByRole('button',{name:'撤销',exact:true}).click();await expect(line.getByLabel('翻译 1',{exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'重做',exact:true}).click();await expect(line.getByLabel('翻译 1',{exact:true})).toHaveValue('译文');
  const background=page.locator('main [data-line-id="bg"]');
  expect(await background.getByLabel('新增翻译的轨道').inputValue()).toBe(await line.getByLabel('新增翻译的轨道').inputValue());
  await background.getByRole('button',{name:'新增翻译',exact:true}).click();await background.getByLabel('翻译 1',{exact:true}).fill('背景译文');await background.getByLabel('翻译 1',{exact:true}).press('Enter');
  await page.getByText('歌词设置',{exact:true}).click();await page.getByRole('button',{name:'歌词元数据',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'歌词元数据'});await expect(dialog.getByRole('heading',{name:'AMLL 元数据编辑'})).toBeVisible();
  await dialog.getByLabel('歌词语言',{exact:true}).fill('ja');await dialog.getByLabel('歌词语言',{exact:true}).press('Enter');
  for(const name of ['作者甲','作者乙']) {await dialog.getByRole('button',{name:'为 songwriter 添加值'}).click();const field=dialog.getByLabel('元数据 songwriter 新值');await field.fill(name);await field.press('Tab');}
  await expect(dialog.getByLabel('元数据 songwriter 值 2')).toHaveValue('作者乙');
  await dialog.getByRole('button',{name:'新增元数据键',exact:true}).click();await dialog.getByLabel('新元数据键').fill('songwriter');await dialog.getByLabel('新元数据键').press('Tab');
  await expect(dialog.getByRole('alert')).toContainText('歌曲作者（iTunes）');await dialog.getByRole('button',{name:'取消新增元数据',exact:true}).click();await page.screenshot({path:test.info().outputPath('metadata-light.png')});
  await page.evaluate(()=>document.documentElement.dataset.theme='dark');await page.screenshot({path:test.info().outputPath('metadata-dark.png')});
  await dialog.getByRole('button',{name:'关闭歌词元数据'}).click();await save(page);
  expect((await envelope(page,id)).document.editing.emptyBeats).toEqual({A:{kind:'word',count:2},r1:{kind:'ruby',count:1}});
  await page.reload();await expect(line.getByLabel('翻译 1',{exact:true})).toHaveValue('译文');
  await page.getByRole('button',{name:'AMLL 预览',exact:true}).click();await page.getByLabel('预览位置').fill('3500');
  await page.getByRole('button',{name:'文件打包',exact:true}).click();const downloading=page.waitForEvent('download');await page.getByRole('button',{name:'下载歌词',exact:true}).click();
  const output=await readFile((await(await downloading).path())!,'utf8');expect(output).toContain('作者乙');expect(output).not.toContain('emptyBeat');
});
test('generated whitespace is omitted and actual word preview remains aligned',async({page})=>{
  const id=await create(page);const text='<tt xmlns="http://www.w3.org/ns/ttml" xmlns:studio="urn:lazulite:studio:draft"><body><p xml:id="a" begin="1" end="3"><span studio:id="ka" begin="1" end="2">か</span><span studio:id="space"> </span><span studio:id="na" begin="2" end="3">な</span></p></body></tt>';
  await importLyrics(page,{name:'empty.ttml',mimeType:'application/xml',buffer:Buffer.from(text)});await page.locator('[data-outline-drag]').first().click();
  await page.getByText('编辑工具',{exact:true}).click();await page.getByRole('button',{name:'生成日文罗马字音译…',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'生成日文罗马字音译'});await dialog.getByLabel('L1单元 2音译').fill('');await dialog.getByLabel('L1单元 2音译').press('Tab');await expect(dialog.getByLabel('L1单元 2音译')).toHaveValue('');
  await dialog.getByRole('button',{name:'生成音译',exact:true}).click();await save(page);
  const snapshot=(await envelope(page,id)).document;
  const projection=await page.evaluate(async snapshot=>{
    // @ts-expect-error browser imports the actual application modules
    const {parseProject}=await import('/src/adapters/project-codec.ts');
    // @ts-expect-error browser imports the actual application modules
    const {toAmllLines}=await import('/src/domain/preview-adapter.ts');
    const document=parseProject(snapshot).lyrics;return {content:document.romanizationTracks[0].contents[0],lyric:toAmllLines(document,true,true)[0].lyric};
  },snapshot);
  expect(projection.content.units).toHaveLength(2);expect(projection.content.units.map((u:{beginMs:number;endMs:number})=>[u.beginMs,u.endMs])).toEqual([[1000,2000],[2000,3000]]);
  expect(projection.lyric.words.filter((w:{romanWord?:string})=>w.romanWord).map((w:{romanWord:string})=>w.romanWord.trim())).toEqual(['ka','na']);
  await page.getByRole('button',{name:'AMLL 预览',exact:true}).click();await page.getByLabel('预览位置').fill('1500');await expect(page.getByRole('region',{name:'AMLL 预览'})).toContainText('ka');
  const roman=page.getByText(/^ka\s*$/).last();
  await expect.poll(async()=>{const a=await roman.boundingBox();const b=await page.locator('[class*="previewPlayer"]').boundingBox();return Boolean(a&&b&&a.y>=b.y&&a.y+a.height<=b.y+b.height);}).toBe(true);
  await page.screenshot({path:test.info().outputPath('word-preview.png')});
});
test('first upload keeps dirty text and undo history and switches preview clock',async({page})=>{
  const id=await create(page);await importLyrics(page,file);const word=page.getByRole('textbox',{name:'词 Alpha',exact:true});await word.fill('Before');await word.press('Enter');
  const audio=await page.request.get('/api/v1/projects/phase3-media/audio');let release!:()=>void;const hold=new Promise<void>(resolve=>release=resolve);
  await page.route('**/api/v1/uploads',async route=>{await hold;await route.continue();});
  await page.getByLabel('上传音乐文件',{exact:true}).setInputFiles({name:'first.wav',mimeType:'audio/wav',buffer:await audio.body()});await expect(page.getByRole('button',{name:'取消上传',exact:true})).toBeVisible();
  const edited=page.getByRole('textbox',{name:'词 Before',exact:true});await edited.fill('During');await edited.press('Enter');release();
  await expect(page.getByLabel('上传音乐文件',{exact:true})).toHaveCount(0);await expect(page.getByRole('textbox',{name:'词 During',exact:true})).toHaveValue('During');
  await page.getByRole('button',{name:'撤销',exact:true}).click();await expect(page.getByRole('textbox',{name:'词 Before',exact:true})).toHaveValue('Before');await save(page);
  expect((await(await page.request.get(`/api/v1/projects/${id}`)).json()).asset).not.toBeNull();await page.getByRole('button',{name:'AMLL 预览',exact:true}).click();await expect(page.getByLabel('预览位置')).toHaveCount(0);
  await page.reload();expect((await envelope(page,id)).document.lyrics.draftTtml).toContain('Before');
});
test('upload failure and cancellation keep project empty and allow retry',async({page})=>{
  const id=await create(page);await importLyrics(page,file);
  const input=page.getByLabel('上传音乐文件',{exact:true});
  await input.setInputFiles({name:'invalid.wav',mimeType:'audio/wav',buffer:Buffer.from('invalid')});await expect(page.getByRole('alert')).toContainText('media probe failed');
  expect((await(await page.request.get(`/api/v1/projects/${id}`)).json()).asset).toBeNull();
  const audio=await page.request.get('/api/v1/projects/phase3-media/audio');
  await page.route('**/api/v1/uploads',async ()=>{ /* Hold this request until the user cancels it. */ });
  await input.setInputFiles({name:'cancel.wav',mimeType:'audio/wav',buffer:await audio.body()});await page.getByRole('button',{name:'取消上传',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('取消');expect((await(await page.request.get(`/api/v1/projects/${id}`)).json()).asset).toBeNull();
  await page.unroute('**/api/v1/uploads');await page.getByRole('button',{name:'重试上传音乐',exact:true}).click();await expect(input).toHaveCount(0);
  await expect(page.getByRole('textbox',{name:'词 Alpha',exact:true})).toHaveValue('Alpha');
});

test('empty project opens acquisition once and remembers the chosen workspace mode', async ({page}) => {
  await create(page); await expect(page.getByRole('button',{name:'歌词获取',exact:true})).toHaveAttribute('aria-current','page');
  await page.getByRole('button',{name:'编辑',exact:true}).click(); await page.reload();
  await expect(page.getByRole('button',{name:'编辑',exact:true})).toHaveAttribute('aria-current','page');
});
