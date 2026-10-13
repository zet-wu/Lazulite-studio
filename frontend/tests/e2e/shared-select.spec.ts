import { expect, test } from '@playwright/test';
import {importLyrics} from '../fixtures/import-lyrics';
import {japaneseReadingTtml} from '../fixtures/japanese-reading';

test('shared popup in a dialog dismisses with Escape at either screen edge and returns focus',async({page})=>{
  await page.setViewportSize({width:1280,height:620});
  await page.goto('/projects/sample-project/edit?scenario=no-music');
  await importLyrics(page,{name:'select.ttml',mimeType:'application/xml',buffer:Buffer.from(japaneseReadingTtml)});
  const row=page.locator('[data-outline-drag]').first();await row.click({button:'right'});
  await page.getByRole('menuitem',{name:'生成日文罗马字音译…'}).click();
  const dialog=page.getByRole('dialog',{name:'生成日文罗马字音译',exact:true});
  const source=dialog.getByRole('combobox',{name:'输出',exact:true});
  // Boundary placement exercises the same live shared control in the dialog portal.
  for(const left of [0,1230]) {
    await source.evaluate((el,left)=>Object.assign(el.style,{position:'fixed',left:`${left}px`,top:'30px',width:'50px'}),left);
    await source.click();
    const popup=dialog.getByRole('listbox');await expect(popup).toBeVisible();
    await page.keyboard.press('ArrowDown');await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();await expect(source).toBeFocused();await expect(popup).toHaveCount(0);
  }
});
