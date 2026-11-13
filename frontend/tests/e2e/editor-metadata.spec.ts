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
 await load(page,xml.replace('type="person"','type="invalid"'));await page.getByRole('button',{name:'文件打包',exact:true}).click();await page.getByRole('button',{name:'下载歌词'}).click();await page.getByRole('button',{name:'歌手 actor: 歌手 type 无效：invalid',exact:true}).click();await expect(page.getByLabel('歌手 actor type')).toBeFocused();await page.getByLabel('歌手 actor type').selectOption('person');await page.getByRole('button',{name:'关闭歌手管理'}).click();await page.getByRole('button',{name:'文件打包',exact:true}).click();await expect(page.getByRole('button',{name:'歌手 actor: 歌手 type 无效：invalid'})).toHaveCount(0);
});
test('output preference survives a panel switch', async ({ page }) => {
 await load(page);
 await page.getByRole('button', { name: '文件打包', exact: true }).click();
 await page.getByLabel('导出格式').selectOption('lrc');
 await page.getByRole('button', { name: '打轴', exact: true }).click();
 await page.getByRole('button', { name: '文件打包', exact: true }).click();
 await expect(page.getByLabel('导出格式')).toHaveValue('lrc');
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

test('source tags fill only blank metadata after blur and leave acquisition conditions intact',async({page})=>{
 await page.goto('/projects/sample-project/edit');await importLyrics(page,{name:'metadata.ttml',mimeType:'application/xml',buffer:Buffer.from(xml)});
 await settings(page,'歌词元数据');const fill=page.getByRole('button',{name:'使用歌曲元数据'});
 await page.getByLabel('元数据 title 值 1').fill('手写标题');await fill.click();await expect(page.getByLabel('元数据 title 值 1')).toHaveValue('手写标题');await expect(page.getByRole('status').filter({hasText:'没有需要填入'})).toBeVisible();
 await page.getByRole('button',{name:'删除元数据 title 及全部值'}).click();await fill.click();await expect(page.getByLabel('元数据 title 值 1')).toHaveValue('源音频标题');await expect(page.getByLabel('元数据 artist 值 1')).toHaveValue('甲');await expect(page.getByLabel('元数据 artist 值 2')).toHaveValue('乙');
 await page.getByRole('button',{name:'关闭歌词元数据'}).click();await page.getByRole('button',{name:'撤销',exact:true}).click();await settings(page,'歌词元数据');await expect(page.getByLabel('元数据 title 值 1')).toHaveCount(0);
 await page.getByRole('button',{name:'关闭歌词元数据'}).click();await page.getByRole('button',{name:'重做',exact:true}).click();await settings(page,'歌词元数据');await expect(page.getByLabel('元数据 title 值 1')).toHaveValue('源音频标题');
 const conditions=await page.evaluate(async()=> (await fetch('/api/v1/projects/sample-project/search-conditions')).json());expect(conditions).toEqual({title:'',artist:'',album:''});
});

test('default singer IDs commit on Enter and blur, cancel and recompute after undo',async({page})=>{
 await load(page);await settings(page,'歌手管理');
 const add=page.getByRole('button',{name:'添加歌手',exact:true});
 await add.click();await expect(page.getByLabel('歌手 ID',{exact:true})).toHaveValue('v1');
 await page.getByRole('button',{name:'取消新增歌手'}).click();await expect(page.getByLabel('歌手 ID v1',{exact:true})).toHaveCount(0);
 await add.click();await page.getByLabel('歌手 ID',{exact:true}).press('Escape');
 await add.click();await page.getByLabel('歌手 ID',{exact:true}).press('Enter');await expect(page.getByLabel('歌手 v1 type')).toBeFocused();
 await add.click();await expect(page.getByLabel('歌手 ID',{exact:true})).toHaveValue('v2');await page.getByLabel('歌手 ID',{exact:true}).press('Tab');await expect(page.getByLabel('歌手 v2 type')).toBeFocused();
 await page.getByRole('button',{name:'关闭歌手管理'}).click();await page.getByRole('button',{name:'撤销',exact:true}).click();await settings(page,'歌手管理');
 await expect(page.getByLabel('歌手 ID v2',{exact:true})).toHaveCount(0);await add.click();await expect(page.getByLabel('歌手 ID',{exact:true})).toHaveValue('v2');
 await page.getByLabel('歌手 ID',{exact:true}).fill('custom');await page.getByLabel('歌手 ID',{exact:true}).press('Enter');await expect(page.getByLabel('歌手 custom type')).toBeFocused();
});

test('actor keyboard editing preserves cycles, updates labels and clears with undo and reload',async({page})=>{
 await load(page);await settings(page,'歌手管理');
 const actor=page.locator('select[aria-label="歌手 actor actor"]');await actor.focus();await actor.press('Enter');
 await expect(page.getByRole('listbox').getByRole('option')).toHaveText(['无','role 长名称角色']);await actor.press('End');await actor.press('Enter');await expect(actor).toHaveValue('role');
 await page.getByLabel('歌手 role type').selectOption('group');await expect(page.getByLabel('歌手 role actor',{exact:true})).toHaveValue('actor');
 await page.getByLabel('歌手 role',{exact:true}).fill('新的长名称');await page.getByLabel('歌手 role',{exact:true}).press('Enter');await expect(actor).toHaveAttribute('title','role 新的长名称');
 await page.getByLabel('歌手 ID role',{exact:true}).fill('renamed');await page.getByLabel('歌手 ID role',{exact:true}).press('Enter');await expect(actor).toHaveValue('renamed');
 await actor.selectOption('');await expect(actor).toHaveValue('');await page.getByRole('button',{name:'关闭歌手管理'}).click();await page.getByRole('button',{name:'撤销',exact:true}).click();await settings(page,'歌手管理');await expect(actor).toHaveValue('renamed');
 await page.getByRole('button',{name:'关闭歌手管理'}).click();await page.getByRole('button',{name:'重做',exact:true}).click();await settings(page,'歌手管理');await expect(actor).toHaveValue('');
 await actor.selectOption('renamed');await page.getByRole('button',{name:'关闭歌手管理'}).click();
 await page.getByRole('button',{name:'保存',exact:true}).click();await expect(page.getByText('已保存',{exact:true})).toBeVisible();await page.reload();await settings(page,'歌手管理');await expect(actor).toHaveValue('renamed');await expect(page.getByLabel('歌手 renamed actor',{exact:true})).toHaveValue('actor');
});

test('an imported self reference stays visible and can be cleared without becoming a candidate',async({page})=>{
 await load(page,xml.replace('<ttm:actor agent="actor"/>','<ttm:actor agent="role"/>'));await settings(page,'歌手管理');
 const actor=page.locator('select[aria-label="歌手 role actor"]');await expect(actor).toHaveValue('role');await expect(actor).toHaveAttribute('title','role 长名称角色');
 await actor.press('Enter');await expect(page.getByRole('listbox').getByRole('option')).toHaveText(['无','actor']);await actor.press('Enter');await expect(actor).toHaveValue('');
});
