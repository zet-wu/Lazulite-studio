import { expect, test } from '@playwright/test';
import { importLyrics } from '../fixtures/import-lyrics';
import { japaneseReadingTtml } from '../fixtures/japanese-reading';

for (const startKey of ['s', 'Shift+G']) test(`timing keys work after button clicks (${startKey})`, async ({ page }) => {
  await page.goto('/projects/sample-project/edit');
  await importLyrics(page, { name: 'ruby.ttml', mimeType: 'application/xml', buffer: Buffer.from(japaneseReadingTtml) });
  if (startKey !== 's') {
    await page.locator('[data-settings-button]').click();
    await page.getByRole('button', { name: '快捷键设置', exact: true }).click();
    await page.getByRole('textbox', { name: '起始轴快捷键' }).click();
    await page.keyboard.press(startKey);
    await page.keyboard.press('Escape');
  }
  await page.locator('[data-ruby-id]').first().click({ position: { x: 3, y: 3 } });
  await page.getByRole('button', { name: '打轴', exact: true }).click();
  await page.locator('audio').evaluate((a: HTMLAudioElement) => { a.currentTime = .25; });
  await page.keyboard.press(startKey);
  await expect(page.getByLabel('选中对象开始秒数')).toHaveValue('0.25');
  const panel = page.getByRole('region', { name: '连续打轴' });
  await panel.getByRole('button', { name: '起始轴', exact: true }).click();
  await page.locator('audio').evaluate((a: HTMLAudioElement) => { a.currentTime = .75; });
  await page.keyboard.press('d');
  await expect(page.getByLabel('选中对象开始秒数')).toHaveValue('0.75');
  await page.locator('audio').evaluate((a: HTMLAudioElement) => { a.currentTime = 1.25; });
  await page.keyboard.press('f');
  await expect(panel).toContainText('单元 3 / 4');
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  await expect(page.getByLabel('读音 っ结束秒数')).toHaveValue('1.25');
  await page.getByRole('button', { name: '打轴', exact: true }).click();
  await page.getByRole('button', { name: /^A / }).click();
  await page.locator('audio').evaluate((a: HTMLAudioElement) => { a.currentTime = 2.25; });
  await page.keyboard.press(startKey);
  await expect(page.getByLabel('选中对象开始秒数')).toHaveValue('2.25');
  await panel.getByRole('button', { name: '上一单元', exact: true }).focus();
  await page.keyboard.press('Space');
  await expect(panel).toContainText('单元 3 / 4');
  await page.keyboard.press('Enter');
  await expect(panel).toContainText('单元 2 / 4');
  await page.keyboard.press('ArrowRight');
  await expect(panel).toContainText('单元 3 / 4');
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(page.getByLabel('选中对象开始秒数')).toHaveValue('2');
});


test('space controls playback from buttons and lyric blocks without activation', async ({page}) => {
  await page.goto('/projects/sample-project/edit');
  await importLyrics(page,{name:'ruby.ttml',mimeType:'application/xml',buffer:Buffer.from(japaneseReadingTtml)});
  await page.locator('main [data-ruby-id]').first().click({position:{x:3,y:3}});
  await page.getByRole('button',{name:'打轴',exact:true}).click();
  const audio=page.locator('audio');
  await audio.evaluate(async (audio:HTMLAudioElement)=>{
    const rate=8000,count=rate*120,buffer=new ArrayBuffer(44+count*2),v=new DataView(buffer);
    const str=(i:number,s:string)=>[...s].forEach((c,j)=>v.setUint8(i+j,c.charCodeAt(0)));
    str(0,'RIFF');v.setUint32(4,36+count*2,true);str(8,'WAVE');str(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,rate,true);v.setUint32(28,rate*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);str(36,'data');v.setUint32(40,count*2,true);
    audio.src=URL.createObjectURL(new Blob([buffer],{type:'audio/wav'}));
    await new Promise<void>(resolve=>audio.addEventListener('loadedmetadata',()=>resolve(),{once:true}));
  });
  await expect.poll(()=>audio.evaluate((a:HTMLAudioElement)=>a.readyState)).toBeGreaterThan(0);
  const panel=page.getByRole('region',{name:'连续打轴'}),button=panel.getByRole('button',{name:'下一单元',exact:true});
  await button.focus();const before=await panel.textContent();
  await page.keyboard.down('Space');await expect.poll(()=>audio.evaluate((a:HTMLAudioElement)=>a.paused)).toBe(false);
  await page.keyboard.down('Space');await page.keyboard.up('Space');
  expect(await panel.textContent()).toBe(before);await expect(button).toBeFocused();
  await page.keyboard.press('Space');await expect.poll(()=>audio.evaluate((a:HTMLAudioElement)=>a.paused)).toBe(true);
  for(const selector of ['section[data-line-id]','[data-word-id]','[data-ruby-id]']){
    const block=page.locator(`main ${selector}`).first();await block.focus();
    await page.keyboard.press('Space');await expect.poll(()=>audio.evaluate((a:HTMLAudioElement)=>a.paused)).toBe(false);
    await page.keyboard.press('Space');await expect.poll(()=>audio.evaluate((a:HTMLAudioElement)=>a.paused)).toBe(true);
    await expect(block).toBeFocused();
  }
  const select=page.locator('select[aria-haspopup="listbox"]').first();await select.focus();const value=await select.inputValue();
  await page.keyboard.press('Space');await expect.poll(()=>audio.evaluate((a:HTMLAudioElement)=>a.paused)).toBe(false);await expect(page.getByRole('listbox')).toHaveCount(0);await expect(select).toHaveValue(value);
  await page.keyboard.press('Space');await expect.poll(()=>audio.evaluate((a:HTMLAudioElement)=>a.paused)).toBe(true);await page.keyboard.press('ArrowDown');await expect(page.getByRole('listbox')).toBeVisible();await page.keyboard.press('Space');await expect(page.getByRole('listbox')).toHaveCount(0);await expect.poll(()=>audio.evaluate((a:HTMLAudioElement)=>a.paused)).toBe(true);
  await page.evaluate(async()=>{const path='/src/features/shortcuts.ts';const {saveBindings,defaultBindings}=await import(path);saveBindings({...defaultBindings,play:{...defaultBindings.play,code:'KeyP'}});});
  await button.focus();await page.keyboard.press('p');await expect.poll(()=>audio.evaluate((a:HTMLAudioElement)=>a.paused)).toBe(false);
  await page.keyboard.press('Space');await expect.poll(()=>audio.evaluate((a:HTMLAudioElement)=>a.paused)).toBe(true);
  await page.locator('[data-settings-button]').click();
  await page.keyboard.press('Space');await expect.poll(()=>audio.evaluate((a:HTMLAudioElement)=>a.paused)).toBe(true);
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'关闭设置',exact:true}).click();
  await page.getByRole('button',{name:'编辑',exact:true}).click();
  const input=page.locator('main input[data-editor-field="word"]').first();await input.focus();await page.keyboard.press('Space');
  await expect.poll(()=>audio.evaluate((a:HTMLAudioElement)=>a.paused)).toBe(true);
});

test('space without music leaves button action unchanged',async({page})=>{
 await page.goto('/projects/sample-project/edit?scenario=no-music');
 const button=page.getByRole('button',{name:'打轴',exact:true});await button.focus();await page.keyboard.press('Space');
 await expect(page.getByRole('region',{name:'连续打轴'})).toHaveCount(0);await expect(button).toBeFocused();
 await page.keyboard.press('Enter');await expect(page.getByRole('region',{name:'连续打轴'})).toBeVisible();
});
