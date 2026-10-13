import { expect, test, type Page } from '@playwright/test';
import { importLyrics } from '../fixtures/import-lyrics';
const xml = `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata"><head><metadata><ttm:agent xml:id="role" type="character"><ttm:name>长名称角色</ttm:name><ttm:actor agent="actor"/></ttm:agent><ttm:agent xml:id="actor" type="person"/><ttm:title>标题</ttm:title><ttm:artist>甲</ttm:artist><ttm:artist>乙</ttm:artist></metadata></head><body><div><p xml:id="L1" begin="00:01.000" end="00:02.000" ttm:agent="role actor">歌</p><p xml:id="L2" begin="00:02.000" end="00:03.000" ttm:agent="actor">曲</p></div></body></tt>`;
async function load(page:Page,source=xml){await page.goto('/projects/sample-project/edit?scenario=no-music');await importLyrics(page,{name:'editor-metadata.ttml',mimeType:'application/xml',buffer:Buffer.from(source)});}
async function settings(page:Page,name:string){await page.getByRole('button',{name:'编辑',exact:true}).click();await page.locator('summary').filter({hasText:'歌词设置'}).click();await page.getByRole('button',{name,exact:true}).click();}
test('metadata edits preserve focus, reject duplicates, cancel locally and delete individual values',async({page})=>{
 await load(page);await settings(page,'歌词元数据');
 await page.mouse.move(0,0);
 const key=page.getByLabel('元数据键 artist',{exact:true});await key.fill('performer');await key.press('Enter');await expect(page.getByLabel('元数据键 performer',{exact:true})).toBeFocused();
 await page.getByLabel('元数据 performer 值 1').fill('');await page.getByLabel('元数据 performer 值 1').press('Escape');await expect(page.getByLabel('元数据 performer 值 1')).toHaveValue('甲');await expect(page.getByRole('dialog',{name:'歌词元数据'})).toBeVisible();
 await page.getByLabel('元数据 performer 值 1').fill(' ');await page.getByLabel('元数据 performer 值 1').press('Enter');await expect(page.getByLabel('元数据 performer 值 1')).toHaveValue('乙');
 await page.getByLabel('元数据键 performer',{exact:true}).fill('title');await page.getByLabel('元数据键 performer',{exact:true}).press('Enter');await expect(page.getByRole('alert')).toContainText('键名非法');await page.getByLabel('元数据键 performer',{exact:true}).press('Escape');
 await page.getByRole('button',{name:'为 performer 添加值'}).click();await page.getByLabel('元数据 performer 新值').fill('丙');await page.getByLabel('元数据 performer 新值').press('Enter');await expect(page.getByLabel('元数据 performer 值 2')).toHaveValue('丙');await expect(page.getByLabel('元数据 performer 值 2')).toBeFocused();
 await page.getByRole('button',{name:'新增元数据键'}).click();await page.getByLabel('新元数据键').fill('custom');await page.getByLabel('新元数据键').press('Tab');await page.getByLabel('新元数据值').fill('新值');await page.getByLabel('新元数据值').press('Enter');await expect(page.getByLabel('元数据 custom 值 1')).toHaveValue('新值');await expect(page.getByLabel('元数据 custom 值 1')).toBeFocused();
 await page.getByRole('button',{name:'关闭歌词元数据'}).click();
});
test('singer rename and reorder retain focus and nested deletion confirmation cancels locally',async({page})=>{
 await load(page);await settings(page,'歌手管理');await page.getByLabel('歌手 ID actor',{exact:true}).fill('performer');await page.getByLabel('歌手 ID actor',{exact:true}).press('Enter');await expect(page.getByLabel('歌手 ID performer',{exact:true})).toBeFocused();
 await page.getByRole('button',{name:'上移歌手 performer'}).click();await expect(page.getByLabel('歌手 performer type')).toBeFocused();await expect(page.getByRole('button',{name:'上移歌手 performer'})).toBeDisabled();
 await page.getByLabel('歌手 role type').selectOption('other');await page.getByRole('button',{name:'删除歌手 performer',exact:true}).click();const confirm=page.getByRole('dialog',{name:'删除歌手 performer',exact:true});await expect(confirm).toContainText('actor 引用：1');await expect(confirm.getByRole('button',{name:'取消',exact:true})).toBeFocused();await page.keyboard.press('Escape');await expect(confirm).toHaveCount(0);await expect(page.getByRole('dialog',{name:'歌手管理',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'删除歌手 performer',exact:true}).click();await page.getByRole('button',{name:'确认删除'}).click();await expect(page.getByLabel('歌手 ID performer',{exact:true})).toHaveCount(0);
});
test('invalid singer types locate the field and do not block plain text',async({page})=>{
 await load(page,xml.replace('type="person"','type="invalid"'));await page.getByRole('button',{name:'文件打包',exact:true}).click();await page.getByRole('button',{name:'下载歌词'}).click();await page.getByRole('button',{name:'歌手 actor：非法 type invalid',exact:true}).click();await expect(page.getByLabel('歌手 actor type')).toBeFocused();await page.getByLabel('歌手 actor type').selectOption('person');await page.getByRole('button',{name:'关闭歌手管理'}).click();await page.getByRole('button',{name:'文件打包',exact:true}).click();await expect(page.getByRole('button',{name:'歌手 actor：非法 type invalid'})).toHaveCount(0);
});
test('sync and output preferences survive panel unmount without restoring completion',async({page})=>{
 await load(page);await page.getByRole('button',{name:'打轴',exact:true}).click();await page.getByLabel('打轴模式').selectOption('line');await page.getByText('回听与校准',{exact:true}).click();await page.getByLabel('输入偏移（毫秒）').fill('75');await page.getByRole('button',{name:'文件打包',exact:true}).click();await page.getByLabel('导出格式').selectOption('lrc');await page.getByRole('button',{name:'打轴',exact:true}).click();await expect(page.getByLabel('打轴模式')).toHaveValue('line');await expect(page.getByText('输入偏移 75 ms')).toBeVisible();await page.getByRole('button',{name:'归零',exact:true}).click();await page.getByRole('button',{name:'文件打包',exact:true}).click();await expect(page.getByLabel('导出格式')).toHaveValue('lrc');
});
test('single switches and mixed batch checkboxes preserve one-step undo',async({page})=>{
 await load(page);await page.locator('[data-outline-drag]').first().click();await page.getByRole('switch',{name:'跳过打轴'}).check();
 await page.locator('[data-outline-drag]').nth(1).click({modifiers:['ControlOrMeta']});const batch=page.getByRole('checkbox',{name:'跳过打轴'});await expect(batch).toHaveAttribute('aria-checked','mixed');await batch.click();await expect(batch).toBeChecked();await page.getByRole('button',{name:'撤销',exact:true}).click();await expect(batch).toHaveAttribute('aria-checked','mixed');
});
test('table fields protect IME and cancel drafts without changing the saved metadata',async({page})=>{
 await load(page);await settings(page,'歌词元数据');const field=page.getByLabel('元数据 artist 值 1');await field.focus();await field.dispatchEvent('compositionstart');await field.fill('新内容');await field.press('Enter');await expect(field).toBeFocused();await field.dispatchEvent('compositionend');await field.press('Escape');await expect(field).toHaveValue('甲');
 await page.getByRole('button',{name:'新增元数据键'}).click();await page.getByLabel('新元数据键').press('Escape');await expect(page.getByLabel('新元数据键')).toHaveCount(0);await expect(page.getByRole('dialog',{name:'歌词元数据'})).toBeVisible();
 await page.getByRole('button',{name:'关闭歌词元数据'}).click();await settings(page,'歌词元数据');await expect(page.getByLabel('元数据 artist 值 1')).toHaveValue('甲');
});
