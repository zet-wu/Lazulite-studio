import {test,expect} from '@playwright/test';
import {importLyrics} from '../fixtures/import-lyrics';
import {phase7Ttml} from '../fixtures/phase7';

test('shared popup in a dialog uses actual height, clips at both edges and returns focus',async({page})=>{
  await page.setViewportSize({width:1280,height:620});
  await page.goto('/projects/sample-project/edit?scenario=no-music');
  await importLyrics(page,{name:'select.ttml',mimeType:'application/xml',buffer:Buffer.from(phase7Ttml)});
  const row=page.locator('[data-outline-drag]').first();await row.click({button:'right'});
  await page.getByRole('menuitem',{name:'生成日文罗马字音译…'}).click();
  const dialog=page.getByRole('dialog',{name:'生成日文罗马字音译',exact:true});
  const source=dialog.getByRole('combobox',{name:'输出',exact:true});
  // Boundary placement exercises the same live shared control in the dialog portal.
  for(const left of [0,1230]) {
    await source.evaluate((el,left)=>Object.assign(el.style,{position:'fixed',left:`${left}px`,top:'30px',width:'50px'}),left);
    await source.click();
    const popup=dialog.getByRole('listbox');await expect(popup).toBeVisible();
    const a=(await source.boundingBox())!,b=(await popup.boundingBox())!;
    expect(Math.abs(b.y-a.y-a.height-4)).toBeLessThan(1);
    expect(b.x).toBeGreaterThanOrEqual(8);expect(b.x+b.width).toBeLessThanOrEqual(1272);
    await page.keyboard.press('ArrowDown');await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();await expect(source).toBeFocused();await expect(popup).toHaveCount(0);
  }
});
