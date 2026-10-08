import {expect,test,type Page} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {importLyrics} from '../fixtures/import-lyrics';
const xml=readFileSync('../tests/fixtures/ttml/amll-phase0-rich.ttml','utf8');
async function settings(page:Page) {await page.locator('[data-top-menu="settings"] > summary').click();await page.getByRole('button',{name:'AMLL 兼容设置',exact:true}).click();}
async function unrestricted(page:Page) {await settings(page);await page.getByRole('switch',{name:'禁用多行背景',exact:true}).uncheck();await page.getByRole('switch',{name:'禁用词级歌手',exact:true}).uncheck();await page.keyboard.press('Escape');}
async function load(page:Page) {await page.goto('/projects/sample-project/edit?scenario=no-music');await unrestricted(page);await importLyrics(page,{name:'rich.ttml',mimeType:'application/xml',buffer:Buffer.from(xml)});}
async function check(page:Page) {await page.getByRole('button',{name:'文件打包',exact:true}).click();await page.getByRole('tab',{name:'AMLL 兼容校验',exact:true}).click();}
test('project gates, word properties, background positions and atomic compatibility processing',async({page})=>{
 await load(page);await expect(page.getByRole('textbox',{name:'词 SecondBG',exact:true})).toBeVisible();
 await page.locator('[data-line-id="bg2"] [data-outline-drag]').click();await page.getByRole('switch',{name:'背景置于主行之前'}).check();
 await expect.poll(()=>page.locator('main [data-line-id]').evaluateAll(els=>els.map(e=>e.getAttribute('data-line-id')))).toEqual(['bg2','main','bg1','next']);
 await page.getByRole('button',{name:'打轴',exact:true}).click();await expect.poll(()=>page.locator('main [data-line-id]').evaluateAll(els=>els.map(e=>e.getAttribute('data-line-id')))).toEqual(['bg2','main','bg1','next']);
 await settings(page);await expect(page.getByRole('switch',{name:'使用 AMLL 简化歌手模型',exact:true})).toBeDisabled();await expect(page.getByRole('switch',{name:'禁用多行背景',exact:true})).toBeDisabled();await page.keyboard.press('Escape');
 await check(page);await page.locator('#amll-noMultipleBackgrounds > div > button[aria-expanded]').click();
 await page.getByRole('button',{name:/^保留首条背景，其余转主行/}).click();
 await expect(page.locator('#amll-noMultipleBackgrounds > div > button[aria-expanded]')).toContainText('满足');
 await page.getByRole('button',{name:'撤销',exact:true}).click();await expect(page.locator('#amll-noMultipleBackgrounds > div > button[aria-expanded]')).toContainText('不满足');
 await page.locator('#amll-simplified > div > button[aria-expanded]').click();await page.getByRole('button',{name:'转换为简化歌手模型',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'转换为简化歌手模型'});await expect(dialog.getByRole('checkbox',{name:'Alice'})).not.toBeChecked();await expect(dialog.getByRole('checkbox',{name:'Bob'})).toBeChecked();await dialog.getByRole('button',{name:'转换',exact:true}).click();
 await settings(page);await page.getByRole('switch',{name:'使用 AMLL 简化歌手模型',exact:true}).check();await expect(page.getByRole('switch',{name:'禁用词级歌手',exact:true})).toBeChecked();await expect(page.getByRole('switch',{name:'禁用词级歌手',exact:true})).toBeDisabled();await page.keyboard.press('Escape');
 await page.getByRole('button',{name:'编辑',exact:true}).click();await page.locator('[data-line-id="main"] [data-outline-drag]').click();await expect(page.getByRole('switch',{name:'对唱歌词'})).toBeChecked();
 await page.getByRole('button',{name:'AMLL 预览',exact:true}).click();await expect(page.getByText('当前 AMLL 预览不能忠实呈现多条背景歌词；完整内容保留在编辑与打轴中。')).toBeVisible();
});
test('import violation keeps current project intact and readonly preview remains available',async({page})=>{
 await page.goto('/projects/sample-project/edit?scenario=no-music');await page.getByRole('button',{name:'歌词获取',exact:true}).click();await page.getByRole('tab',{name:'文件',exact:true}).click();await page.locator('input[type=file][accept^=".ttml"]').setInputFiles({name:'rich.ttml',mimeType:'application/xml',buffer:Buffer.from(xml)});
 await expect(page.locator('p').filter({hasText:'SecondBG'})).toBeVisible();await page.getByRole('button',{name:'确认导入并替换歌词',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'禁用多行背景'})).toBeVisible();await page.getByRole('button',{name:'编辑',exact:true}).click();await expect(page.getByRole('textbox',{name:'词 SecondBG',exact:true})).toHaveCount(0);
});
test('preposed audio outline keeps explicit selection and large compatibility results act on selected words',async({page})=>{
 await page.goto('/projects/sample-project/edit');await unrestricted(page);await importLyrics(page,{name:'rich.ttml',mimeType:'application/xml',buffer:Buffer.from(xml)});await page.locator('[data-line-id="bg2"] [data-outline-drag]').click();await page.getByRole('switch',{name:'背景置于主行之前'}).check();
 await page.getByRole('button',{name:'音频处理',exact:true}).click();const rows=page.getByLabel('音频处理大纲').locator('[data-outline-drag]');
 await rows.nth(0).click();await rows.nth(3).click({modifiers:['Control']});
 await expect(rows.nth(0)).toHaveAttribute('aria-pressed','true');await expect(rows.nth(1)).toHaveAttribute('aria-pressed','false');await expect(rows.nth(2)).toHaveAttribute('aria-pressed','false');await expect(rows.nth(3)).toHaveAttribute('aria-pressed','true');
 await page.getByRole('button',{name:'编辑',exact:true}).click();await expect(page.locator('[data-line-id="bg2"] [data-outline-drag]')).toHaveAttribute('aria-pressed','true');await expect(page.locator('[data-line-id="next"] [data-outline-drag]')).toHaveAttribute('aria-pressed','true');
 const words=Array.from({length:1200},(_,i)=>`<span ttm:agent="a">word${i}</span>`).join('');
 await importLyrics(page,{name:'large.ttml',mimeType:'application/xml',buffer:Buffer.from(`<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata"><head><metadata><ttm:agent xml:id="a" type="person"/></metadata></head><body><p xml:id="line">${words}</p></body></tt>`)});
 await check(page);const rule=page.locator('#amll-noWordAgents');await expect(rule.locator('li')).toHaveCount(0);await rule.locator(':scope > div > button[aria-expanded]').click();await rule.getByRole('button',{name:/^第 1 行/}).click();await expect(rule.locator('li')).toHaveCount(50);
 await rule.getByRole('button',{name:/再显示 50 项/}).click();await expect(rule.locator('li')).toHaveCount(100);await rule.getByRole('checkbox',{name:'选择 word89',exact:true}).check();await expect(rule.getByText('范围：选中 1 项')).toBeVisible();const scrollBefore=await rule.locator('ul').evaluate(el=>el.scrollTop);await rule.getByRole('button',{name:/^清除词级歌手/}).click();await expect(rule.getByText('1199 个词，涉及 1 行')).toBeVisible();expect(Math.abs(await rule.locator('ul').evaluate(el=>el.scrollTop)-scrollBefore)).toBeLessThan(40);
 await rule.getByRole('button',{name:'word90',exact:true}).focus();await page.keyboard.press('Enter');await expect(page.getByRole('textbox',{name:'词 word90',exact:true}).locator('xpath=ancestor::*[@data-word-id][1]')).toBeFocused();await expect(page.getByLabel('词级歌手 a',{exact:true})).toBeChecked();
});
test('removes obsolete recovery databases while preserving current and unrelated data',async({page})=>{
 await page.goto('/projects');await page.evaluate(async()=>{
  for(const name of ['lazulite-studio-recovery','lazulite-studio-recovery-project-v3','unrelated-app'])await new Promise<void>((resolve,reject)=>{const request=indexedDB.open(name,1);request.onupgradeneeded=()=>request.result.createObjectStore('sample');request.onsuccess=()=>{request.result.close();resolve();};request.onerror=()=>reject(request.error);});
 });
 await page.goto('/projects/sample-project/edit?scenario=no-music');await expect(page.getByRole('button',{name:'编辑',exact:true})).toBeVisible();
 await expect.poll(()=>page.evaluate(async()=>(await indexedDB.databases()).map(db=>db.name).sort())).toEqual(['lazulite-studio-recovery-project-v4','unrelated-app']);
});
