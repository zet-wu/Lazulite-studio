import {test,expect} from '@playwright/test';
import {importLyrics} from '../fixtures/import-lyrics';
import {japaneseReadingTtml} from '../fixtures/japanese-reading';

test('simple editor shares editing, preferences, selection and sync data',async({page},info)=>{
  await page.goto('/projects/sample-project/edit');
  await importLyrics(page,{name:'ruby.ttml',mimeType:'application/xml',buffer:Buffer.from(japaneseReadingTtml)});
  const view=page.locator('[data-top-menu="view"]');
  await view.locator('summary').click();
  await view.getByRole('button',{name:'简洁模式',exact:true}).click();
  await expect(page.locator('[data-sync-marker]')).toHaveCount(0);
  await expect(page.getByRole('region',{name:'连续打轴'})).toHaveCount(0);
  const word=page.locator('main [data-word-id]').first();
  await word.focus();await page.keyboard.press('F2');
  const input=word.locator('input');await expect(input).toBeFocused();
  await input.fill('修改');await input.press('Enter');
  await expect(word).toContainText('修改');
  await page.getByRole('button',{name:'撤销',exact:true}).click();
  await expect(word).not.toContainText('修改');
  await page.screenshot({path:info.outputPath('simple-light.png')});
  await page.evaluate(()=>{document.documentElement.dataset.theme='dark';});
  await page.screenshot({path:info.outputPath('simple-dark.png')});
  await page.evaluate(()=>{document.documentElement.dataset.theme='light';});
  await page.locator('[data-settings-button]').click();
  const dialog=page.getByRole('dialog',{name:'设置',exact:true});
  await expect(dialog.getByRole('combobox',{name:'编辑显示模式'})).toHaveValue('simple');
  await dialog.getByRole('combobox',{name:'编辑显示模式'}).selectOption('advanced');
  await page.keyboard.press('Escape');
  await expect(page.locator('main input[data-editor-field="word"]').first()).toBeVisible();
  await view.locator('summary').click();await view.getByRole('button',{name:'简洁模式',exact:true}).click();
  await page.getByRole('button',{name:'打轴',exact:true}).click();
  await expect(page.locator('[data-sync-marker="dot"]').first()).toBeVisible();
  await page.getByRole('button',{name:'编辑',exact:true}).click();
  await expect(page.locator('[data-sync-marker]')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('main [data-word-id]').first()).toBeVisible();
  await expect(page.locator('main input[data-editor-field="word"]')).toHaveCount(0);
});

test('composition blocks display switching and hidden tracks become line selection',async({page})=>{
  const {inlineEditingTtml}=await import('../fixtures/inline-editing');
  await page.goto('/projects/sample-project/edit?scenario=no-music');
  await importLyrics(page,{name:'tracks.ttml',mimeType:'application/xml',buffer:Buffer.from(inlineEditingTtml())});
  const input=page.locator('main input[data-editor-field="word"]').first();
  await input.focus();await input.dispatchEvent('compositionstart');
  const view=page.locator('[data-top-menu="view"]');
  await view.locator('summary').click();await view.getByRole('button',{name:'简洁模式',exact:true}).click();
  await expect(input).toBeVisible();
  await input.dispatchEvent('compositionend');
  await page.locator('main [data-romanization-unit-id]').first().click({position:{x:3,y:3}});
  await view.locator('summary').click();await view.getByRole('button',{name:'简洁模式',exact:true}).click();
  await expect(page.locator('main [data-romanization-unit-id]')).toHaveCount(0);
  await expect(page.locator('main section[data-line-id="english"]')).toHaveAttribute('data-selected','true');
  await view.locator('summary').click();await view.getByRole('button',{name:'高级模式',exact:true}).click();
  await expect(page.locator('main [data-romanization-unit-id]')).toHaveCount(4);
});

for(const theme of ['light','dark'])test(`model cards support keyboard selection and ${theme} theme`,async({page},info)=>{
  await page.goto('/projects/sample-project/edit');
  await page.locator('[data-settings-button]').click();
  const dialog=page.getByRole('dialog',{name:'设置',exact:true});
  await dialog.getByRole('combobox',{name:'主题',exact:true}).selectOption(theme);
  await dialog.getByRole('button',{name:'模型与计算',exact:true}).click();
  const group=dialog.getByRole('radiogroup',{name:'人声分离模型管理'});
  const demucs=group.getByRole('radio',{name:/Demucs/}),bs=group.getByRole('radio',{name:/BS Karaoke/});
  await expect(demucs).toHaveAttribute('aria-checked','true');
  await demucs.focus();await page.keyboard.press('ArrowRight');
  await expect(bs).toBeFocused();await expect(bs).toHaveAttribute('aria-checked','true');
  await group.scrollIntoViewIfNeeded();await dialog.screenshot({path:info.outputPath(`models-${theme}.png`)});
  await page.keyboard.press('Escape');await page.locator('[data-settings-button]').click();
  await dialog.getByRole('button',{name:'模型与计算',exact:true}).click();
  await expect(bs).toHaveAttribute('aria-checked','true');
});

test('model selection rolls back after failed save',async({page})=>{
  await page.goto('/projects/sample-project/edit?scenario=preference-failure');
  await expect(page.locator('[data-settings-button]')).toBeVisible();
  await page.evaluate(async()=>{const path='/src/adapters/preferences.ts';const adapter=await import(path);await adapter.loadPreferences();});
  await page.locator('[data-settings-button]').click();
  const dialog=page.getByRole('dialog',{name:'设置',exact:true});
  await dialog.getByRole('button',{name:'模型与计算',exact:true}).click();
  await dialog.getByRole('radio',{name:/BS Karaoke/}).click();
  await expect(dialog.getByRole('radio',{name:/Demucs/})).toHaveAttribute('aria-checked','true');
  await expect(dialog.getByRole('alert').first()).toBeVisible();
});

test('simple background rows retain multi-selection, clipboard and drag undo',async({page})=>{
  const {backgroundContentTtml}=await import('../fixtures/background-content');
  await page.goto('/projects/sample-project/edit?scenario=no-music');
  await importLyrics(page,{name:'background.ttml',mimeType:'application/xml',buffer:Buffer.from(backgroundContentTtml)});
  const view=page.locator('[data-top-menu="view"]');
  await view.locator('summary').click();await view.getByRole('button',{name:'简洁模式',exact:true}).click();
  await expect(page.locator('main section[data-background="true"]')).toHaveCount(1);
  const words=page.locator('main [data-word-id]');
  await words.nth(1).click({position:{x:3,y:3}});await words.nth(2).click({position:{x:3,y:3},modifiers:['Control']});
  await expect(page.getByLabel('编辑操作').getByText('词已选 2',{exact:true})).toBeVisible();
  await page.locator('[data-top-menu="clipboard"] summary').click();await page.getByRole('button',{name:'复制',exact:true}).click();
  await words.nth(1).focus();await page.keyboard.press('Delete');
  await expect(words).toHaveCount(2);
  await page.getByRole('button',{name:'撤销',exact:true}).click();await expect(words).toHaveCount(4);
  const from=words.nth(2),to=words.nth(1);const id=await from.getAttribute('data-word-id');
  const a=(await from.boundingBox())!,b=(await to.boundingBox())!;
  await page.mouse.move(a.x+3,a.y+3);await page.mouse.down();await page.mouse.move(b.x+2,b.y+2,{steps:8});await expect(page.locator('[data-object-drag]')).toHaveCount(1);await expect(from).toHaveAttribute('data-drag-placeholder','');await page.mouse.up();
  await expect(words.nth(1)).toHaveAttribute('data-word-id',id!);
  await page.getByRole('button',{name:'撤销',exact:true}).click();await expect(words.nth(2)).toHaveAttribute('data-word-id',id!);
});

test('unavailable vocal model shows its reason and cannot be selected',async({page})=>{
  await page.goto('/projects/sample-project/edit?scenario=missing-vocal-model');
  await page.locator('[data-settings-button]').click();
  const dialog=page.getByRole('dialog',{name:'设置',exact:true});
  await dialog.getByRole('button',{name:'模型与计算',exact:true}).click();
  await expect(dialog.getByRole('radio',{name:/BS Karaoke/})).toBeDisabled();
  await expect(dialog.getByRole('radio',{name:/BS Karaoke/})).toContainText('Missing weights');
});
