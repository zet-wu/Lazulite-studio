import {expect,test} from '@playwright/test';
import {importLyrics} from '../../fixtures/import-lyrics';

test('settings persist defaults and share preview preferences',async({page})=>{
 await page.goto('/projects/music-packaging/edit');
 await page.locator('[data-settings-button]').click();
 const dialog=page.getByRole('dialog',{name:'设置',exact:true});
 await dialog.getByRole('button',{name:'注音与拉丁化',exact:true}).click();
 const highlight=dialog.getByLabel('音译高亮字符默认值');await highlight.fill('ヘ は ヘ');await highlight.blur();await expect(highlight).toHaveValue('へは');
 await dialog.getByLabel('自动转换日语助词读音',{exact:false}).uncheck();
 await dialog.getByRole('button',{name:'模型与计算',exact:true}).click();
 const gap=dialog.getByLabel('行内空隙阈值（毫秒）');await gap.fill('321');await gap.blur();
 await dialog.getByRole('button',{name:'AMLL 预览',exact:true}).click();
 await dialog.getByLabel('翻译', {exact:true}).uncheck();
 await page.keyboard.press('Escape');await expect(page.locator('[data-settings-button]')).toBeFocused();
 await page.getByRole('button',{name:'AMLL 预览',exact:true}).click();await expect(page.getByLabel('翻译',{exact:true})).not.toBeChecked();
 await page.getByLabel('翻译',{exact:true}).check();
 await page.reload();await page.locator('[data-settings-button]').click();
 await dialog.getByRole('button',{name:'注音与拉丁化',exact:true}).click();await expect(highlight).toHaveValue('へは');
 await expect(dialog.getByLabel('自动转换日语助词读音',{exact:false})).not.toBeChecked();
 await dialog.getByRole('button',{name:'模型与计算',exact:true}).click();await expect(gap).toHaveValue('321');
 await page.keyboard.press('Escape');
});

test('real particle analysis generates both modes and adoption survives undo redo and save',async({page})=>{
 await page.goto('/projects/background-playback/edit');
 await page.locator('[data-settings-button]').click();
 await page.getByRole('button',{name:'注音与拉丁化',exact:true}).click();
 await page.getByLabel('自动转换日语助词读音',{exact:false}).check();await page.keyboard.press('Escape');
 await importLyrics(page,{name:'particles.ttml',mimeType:'application/xml',buffer:Buffer.from('<tt xmlns="http://www.w3.org/ns/ttml"><body><p begin="0" end="4"><span begin="0" end="4">わたしははなへ</span></p></body></tt>')});
 await page.locator('[data-outline-drag]').first().click({button:'right'});
 await page.getByRole('menuitem',{name:'生成日文罗马字音译',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'生成日文罗马字音译',exact:true});
 await expect(dialog.getByLabel('L1单元 1音译')).toHaveValue('watashiwahanae');
 await dialog.getByLabel('输出').selectOption('plain');await expect(dialog.getByLabel('L1音译')).toHaveValue('watashiwahanae');
 await dialog.getByRole('button',{name:'生成音译',exact:true}).click();
 await page.getByRole('button',{name:'撤销',exact:true}).click();await page.getByRole('button',{name:'重做',exact:true}).click();
 await page.getByRole('button',{name:'保存',exact:true}).click();await expect(page.getByText('已保存',{exact:true})).toBeVisible();
 await page.reload();await expect(page.getByLabel('音译 ja-Latn',{exact:true})).toHaveValue('watashiwahanae');
});
