import { expect,test } from '@playwright/test';
import { importLyrics } from '../fixtures/import-lyrics';
const xml=`<tt xmlns="http://www.w3.org/ns/ttml" xmlns:tts="http://www.w3.org/ns/ttml#styling" xmlns:studio="urn:lazulite:studio:draft"><body><p xml:id="a" begin="4" end="7"><span studio:id="w" tts:ruby="container" begin="4" end="5"><span tts:ruby="base">愛</span><span tts:ruby="textContainer"><span studio:id="r1" tts:ruby="text" begin="4.2" end="4.3">あ</span><span studio:id="r2" tts:ruby="text" begin="4.9" end="5">い</span></span></span><span studio:id="b" begin="5.6" end="7">●</span></p><p xml:id="c" begin="10" end="11"><span studio:id="cw" begin="10" end="11">C</span></p></body></tt>`;
async function load(page:import('@playwright/test').Page){await page.setViewportSize({width:1440,height:1000});await page.goto('/projects/sample-project/edit');await importLyrics(page,{name:'karaoke.ttml',mimeType:'application/xml',buffer:Buffer.from(xml)});await page.getByRole('button',{name:'卡拉 OK',exact:true}).click();}
test('yellow slots insert once on double click, share cue properties and keep original literal circles',async({page})=>{
 await load(page);
 await page.getByRole('button',{name:'插入行内导唱',exact:true}).dblclick();
 await expect(page.locator('main [data-cue-id]')).toHaveCount(1);
 await expect(page.getByLabel('导唱开始秒数')).toHaveValue('5');
 await page.getByLabel('导唱结束秒数').fill('5.4');await page.getByLabel('导唱结束秒数').press('Tab');
 await expect(page.getByRole('button',{name:'插入行内导唱',exact:true})).toHaveCount(0);
 await expect(page.locator('main [data-word-id="b"]')).toHaveText('●');
 await page.locator('main [data-cue-id]').dblclick();await page.locator('main').getByRole('textbox',{name:'导唱文字',exact:true}).fill('●●');await page.locator('main').getByRole('textbox',{name:'导唱文字',exact:true}).press('Enter');
 await expect(page.locator('main [data-cue-id]')).toHaveText('●●');
 await page.getByRole('button',{name:'删除导唱',exact:true}).click();await expect(page.getByRole('button',{name:'插入行内导唱',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'撤销',exact:true}).click();await expect(page.locator('main [data-cue-id]')).toHaveText('●●');
 await page.screenshot({path:test.info().outputPath('karaoke-light.png')});
 await page.locator('[data-top-menu="view"] summary').click();await page.getByRole('button',{name:'夜间模式',exact:true}).click();await page.screenshot({path:test.info().outputPath('karaoke-dark.png')});
});
test('auto insertion is idempotent and export ZIP can return from focused validation',async({page})=>{
 await load(page);await page.getByRole('button',{name:'自动插入导唱符',exact:true}).click();await expect(page.locator('main [data-cue-id]')).toHaveCount(3);
 await page.getByRole('button',{name:'自动插入导唱符',exact:true}).click();await expect(page.locator('main [data-cue-id]')).toHaveCount(3);
 await page.getByRole('button',{name:'导出 Nicokara',exact:true}).click();await expect(page.getByRole('dialog').getByRole('status')).toContainText('0 项阻塞');
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'下载 ZIP',exact:true}).click();expect((await download).suggestedFilename()).toMatch(/-nicokara.zip$/);
 await page.getByRole('button',{name:'查看校验',exact:true}).click();await expect(page.getByLabel('校验格式筛选')).toHaveValue('nicokara');
 await page.getByRole('button',{name:'返回 Nicokara 导出',exact:true}).click();await expect(page.getByRole('dialog',{name:'导出 Nicokara',exact:true})).toBeVisible();
});
test('group edits and a cue survive real mock save/reopen',async({page})=>{
 await load(page);await page.getByRole('button',{name:'添加行前导唱',exact:true}).first().click();
 await page.getByRole('button',{name:'分组管理',exact:true}).click();await page.getByLabel('分组名称 main',{exact:true}).fill('主声部');await page.getByRole('button',{name:'应用分组',exact:true}).click();
 await page.getByRole('button',{name:'保存',exact:true}).click();await expect(page.getByText('已保存',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'导出 Nicokara',exact:true}).click();await expect(page.getByRole('dialog').getByText('主声部 · 正文',{exact:true})).toBeVisible();
});
test('downloaded project reopens cues and groups in the same project, with one undo',async({page})=>{
 await load(page);await page.getByRole('button',{name:'添加行前导唱',exact:true}).first().click();
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'下载项目',exact:true}).click();const file=await (await download).path();
 await page.getByRole('button',{name:'删除导唱',exact:true}).click();await expect(page.locator('main [data-cue-id]')).toHaveCount(0);
 await page.getByLabel('重开项目文件').setInputFiles(file!);await expect(page.locator('main [data-cue-id]')).toHaveCount(1);
 await page.getByRole('button',{name:'撤销',exact:true}).click();await expect(page.locator('main [data-cue-id]')).toHaveCount(0);
});
test('timeline cue selects shared properties, resizes within range and rejects out of bounds',async({page})=>{
 await load(page);await page.getByRole('button',{name:'添加行前导唱',exact:true}).first().click();
 const cue=page.getByRole('button',{name:'时间轴导唱 ●',exact:true});await cue.click();await expect(page.getByLabel('导唱开始秒数')).toHaveValue('3');
 await page.getByRole('checkbox',{name:'吸附',exact:true}).uncheck();
 const handle=cue.getByRole('button',{name:'导唱开始端点'}),box=(await handle.boundingBox())!;
 await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2-8,box.y+box.height/2);await page.mouse.up();
 expect(Number(await page.getByLabel('导唱开始秒数').inputValue())).toBeLessThan(3);
 const before=await page.getByLabel('导唱开始秒数').inputValue(),again=(await handle.boundingBox())!;
 await page.mouse.move(again.x+again.width/2,again.y+again.height/2);await page.mouse.down();await page.mouse.move(again.x+again.width/2-100,again.y+again.height/2);await page.mouse.up();
 await expect(page.getByLabel('导唱开始秒数')).toHaveValue(before);
});
test('fresh selected-output validation locates a retimed cue and returns after repair',async({page})=>{
 await load(page);await page.getByRole('button',{name:'插入行内导唱',exact:true}).click();
 await page.locator('main [data-word-id="b"]').click();await page.getByLabel('选中对象开始秒数').fill('5.2');await page.getByLabel('选中对象开始秒数').press('Tab');
 await page.getByRole('button',{name:'导出 Nicokara',exact:true}).click();await expect(page.getByRole('dialog').getByRole('status')).not.toContainText('0 项阻塞');
 await page.getByRole('button',{name:'查看校验',exact:true}).click();await page.getByRole('button',{name:'导唱双端必须位于原空隙内且具有正时长',exact:true}).click();
 await expect(page.getByLabel('导唱结束秒数')).toHaveValue('5.6');await page.getByLabel('导唱结束秒数').fill('5.1');await page.getByLabel('导唱结束秒数').press('Tab');
 await page.getByRole('button',{name:'导出 Nicokara',exact:true}).click();await expect(page.getByRole('dialog').getByRole('status')).toContainText('0 项阻塞');
});
