import {expect,test} from '@playwright/test';

test('shortcut conflicts stay with their field and per-action reset restores the default',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('studio:sync-style','amll'));
 await page.goto('/projects/sample-project/edit?scenario=no-music');
 await page.locator('[data-settings-button]').click();
 const dialog=page.getByRole('dialog',{name:'设置',exact:true});
 await dialog.getByRole('button',{name:'快捷键设置',exact:true}).click();
 const input=dialog.getByRole('textbox',{name:'起始轴快捷键'});
 await input.press('d');await expect(input).toHaveValue('S');await expect(input).toHaveAttribute('aria-invalid','true');await expect(dialog.getByRole('alert')).toContainText('冲突');
 await input.press('Shift+G');await expect(input).toHaveValue('Shift + G');await expect(dialog.getByRole('alert')).toHaveCount(0);
 await dialog.getByRole('button',{name:'恢复“起始轴”默认快捷键',exact:true}).click();await expect(input).toHaveValue('S');
 await page.keyboard.press('Escape');await expect(page.locator('[data-settings-button]')).toBeFocused();
 await page.locator('[data-settings-button]').click();await dialog.getByRole('button',{name:'快捷键设置',exact:true}).click();await expect(input).toHaveValue('S');
});
