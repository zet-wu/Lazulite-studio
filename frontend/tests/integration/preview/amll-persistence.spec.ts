import {expect,test,type Page} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {importLyrics} from '../../fixtures/import-lyrics';
async function create(page:Page,name:string){await page.goto('/projects');await page.getByRole('button',{name:'新建项目',exact:true}).click();await page.getByLabel('项目名称',{exact:true}).fill(name);await page.getByRole('button',{name:'创建项目',exact:true}).click();await page.waitForURL(/\/projects\/[^/]+\/edit/);return page.url().split('/projects/')[1].split('/')[0];}
async function save(page:Page){await page.getByRole('button',{name:'保存',exact:true}).click();await expect(page.getByText('已保存',{exact:true})).toBeVisible();}
test('real service settings, multi backgrounds, word singers, position and isolated projects reopen',async({page})=>{
 const id=await create(page,'AMLL 完整交换');await page.locator('[data-top-menu=settings] > summary').click();await page.getByRole('button',{name:'AMLL 兼容设置',exact:true}).click();await page.getByRole('switch',{name:'禁用多行背景',exact:true}).uncheck();await page.getByRole('switch',{name:'禁用词级歌手',exact:true}).uncheck();await page.keyboard.press('Escape');
 await importLyrics(page,{name:'rich.ttml',mimeType:'application/xml',buffer:readFileSync('../tests/fixtures/ttml/amll-rich.ttml')});
 await page.locator('[data-line-id=bg2] [data-outline-drag]').click();await page.getByRole('switch',{name:'背景置于主行之前'}).check();await save(page);
 const snapshot=(await(await page.request.get(`/api/v1/projects/${id}/document`)).json()).document;
 expect(snapshot.amll.noMultipleBackgrounds).toBe(false);expect(snapshot.lineOrder).toEqual(['bg2','main','bg1','next']);expect(snapshot.lyrics.draftTtml).toContain('ttm:agent="b a"');
 await page.reload();await expect(page.getByRole('textbox',{name:'词 SecondBG',exact:true})).toBeVisible();await expect.poll(()=>page.locator('main [data-line-id]').evaluateAll(els=>els.map(el=>el.getAttribute('data-line-id')))).toEqual(['bg2','main','bg1','next']);
 await page.getByRole('textbox',{name:'词 Main',exact:true}).click();await expect(page.getByLabel('词级歌手 Alice',{exact:true})).toBeChecked();await page.getByLabel('词级歌手 Alice',{exact:true}).uncheck();await save(page);
 const next=await create(page,'AMLL 默认设置');expect(next).not.toBe(id);await page.locator('[data-top-menu=settings] > summary').click();await page.getByRole('button',{name:'AMLL 兼容设置',exact:true}).click();await expect(page.getByRole('switch',{name:'禁用多行背景',exact:true})).toBeChecked();await expect(page.getByRole('switch',{name:'禁用词级歌手',exact:true})).toBeChecked();
 await page.goto(`/projects/${id}/edit`);await page.getByRole('textbox',{name:'词 Main',exact:true}).click();await expect(page.getByLabel('词级歌手 Alice',{exact:true})).not.toBeChecked();
});
