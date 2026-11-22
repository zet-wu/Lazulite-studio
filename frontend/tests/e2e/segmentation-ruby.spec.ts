import { test, expect, type Page } from '@playwright/test';
import { importLyrics } from '../fixtures/import-lyrics';
const xml = `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:tts="http://www.w3.org/ns/ttml#styling"><body><div><p begin="0" end="2"><span begin="0" end="1" tts:ruby="container"><span tts:ruby="base">甲乙丙丁</span><span tts:ruby="textContainer">${['a','b','c','d'].map((r,i)=>`<span tts:ruby="text" begin="${0.1+i*.1}" end="${.2+i*.1}">${r}</span>`).join('')}</span></span><span begin="1" end="2" tts:ruby="container"><span tts:ruby="base">上下文</span><span tts:ruby="textContainer"><span tts:ruby="text" begin="1" end="1.5">x</span><span tts:ruby="text" begin="1.5" end="2">y</span></span></span></p><p begin="3" end="4"><span begin="3" end="4">第二行</span></p></div></body></tt>`;
async function prepare(page: Page) {
 await page.goto('/projects/sample-project/edit?scenario=no-music');
 await importLyrics(page,{name:'ruby-segments.ttml',mimeType:'application/xml',buffer:Buffer.from(xml)});
 await page.locator('[data-outline-drag]').first().click();
 await page.locator('[data-top-menu="tools"] summary').click();await page.getByRole('button',{name:'批处理',exact:true}).click();await page.getByRole('button',{name:'分词',exact:true}).click();
 return page.getByRole('dialog');
}
test('ruby drag enforces order, keyboard movement commits and survives save undo redo reload',async({page})=>{
 const dialog=await prepare(page);
 await dialog.getByRole('button',{name:'切分边界 2',exact:true}).first().click();
 const pieces=dialog.locator('[class*="segmentPiece"]');
 await dialog.getByRole('button',{name:'a',exact:true}).dragTo(pieces.nth(1));
 await expect(pieces.nth(0).getByRole('button',{name:'a',exact:true})).toBeVisible();
 await dialog.getByRole('button',{name:'b',exact:true}).dragTo(pieces.nth(1));
 await expect(pieces.nth(1).getByRole('button',{name:'b',exact:true})).toBeVisible();
 await dialog.getByRole('button',{name:'b',exact:true}).focus();await page.keyboard.press('ArrowLeft');
 await expect(dialog.getByRole('button',{name:'b',exact:true})).toBeFocused();
 await expect(pieces.nth(0).getByRole('button',{name:'b',exact:true})).toBeVisible();
 await page.keyboard.press('ArrowRight');
 await expect(dialog.getByRole('button',{name:'b',exact:true})).toBeFocused();
 await dialog.getByRole('button',{name:'应用'}).click();await expect(page.locator('main [data-word-id]')).toHaveCount(4);
 await page.getByRole('button',{name:'撤销',exact:true}).click();await expect(page.locator('main [data-word-id]')).toHaveCount(3);
 await page.getByRole('button',{name:'重做',exact:true}).click();await expect(page.locator('main [data-word-id]')).toHaveCount(4);
 await page.getByRole('button',{name:'保存',exact:true}).click();await expect(page.getByText('已保存',{exact:true})).toBeVisible();await page.reload();await expect(page.locator('main [data-word-id]')).toHaveCount(4);
 const words=page.locator('main [data-word-id]');await expect(words.nth(0).locator('[data-ruby-id]')).toHaveCount(1);await expect(words.nth(1).locator('[data-ruby-id]')).toHaveCount(3);
});
test('multi-selection drag rejects another source and moves selected suffix together',async({page})=>{
 const dialog=await prepare(page);await dialog.getByRole('button',{name:'切分边界 3',exact:true}).click();
 await dialog.getByRole('button',{name:'b',exact:true}).click();await dialog.getByRole('button',{name:'c',exact:true}).click({modifiers:['Control']});
 const pieces=dialog.locator('[class*="segmentPiece"]');
 await dialog.getByRole('button',{name:'b',exact:true}).dragTo(pieces.nth(2));await expect(pieces.nth(0).getByRole('button',{name:'b',exact:true})).toBeVisible();
 await dialog.getByRole('button',{name:'b',exact:true}).dragTo(pieces.nth(1));await expect(pieces.nth(1).getByRole('button',{name:/^[bcd]$/})).toHaveCount(3);
 await dialog.getByRole('button',{name:'取消',exact:true}).click();await expect(page.locator('main [data-word-id]')).toHaveCount(3);
});
test('single word ruby preset uses the same editable draft',async({page})=>{
 const dialog=await prepare(page);await dialog.getByRole('button',{name:'取消',exact:true}).click();
 await page.locator('main [data-word-id]').first().click({button:'right',position:{x:3,y:3}});await page.getByRole('menuitem',{name:'拆分词',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'拆分词'})).toBeVisible();await expect(dialog.getByRole('button',{name:'切分边界 2',exact:true})).toHaveAttribute('aria-pressed','true');
 await dialog.getByRole('button',{name:'切分边界 2',exact:true}).click();await expect(dialog.getByRole('button',{name:'切分边界 2',exact:true})).toBeFocused();await dialog.getByRole('button',{name:'应用'}).click();await expect(page.locator('main [data-word-id]')).toHaveCount(5);
});

test('ruby clicks are exclusive across sources and modifier selections follow editor semantics',async({page})=>{
 const dialog=await prepare(page),ruby=(name:string)=>dialog.getByRole('button',{name,exact:true});
 const selected=()=>dialog.locator('[data-segment-ruby][aria-pressed="true"]');
 await ruby('a').click();await ruby('c').click({modifiers:['Shift']});await expect(selected()).toHaveText(['a','b','c']);
 await ruby('b').click({modifiers:['Control']});await expect(selected()).toHaveText(['a','c']);
 await ruby('x').click();await expect(selected()).toHaveText(['x']);
 await ruby('b').click({modifiers:['Control']});await expect(selected()).toHaveText(['b']);
 await ruby('y').click({modifiers:['Shift']});await expect(selected()).toHaveText(['y']);
 await ruby('x').click({modifiers:['Control']});await expect(selected()).toHaveText(['x','y']);
 await ruby('x').click();await expect(selected()).toHaveText(['x']);
 await dialog.getByRole('button',{name:'切分边界 3',exact:true}).click();
 await ruby('b').click();await ruby('c').click({modifiers:['Shift']});await ruby('c').press('ArrowRight');
 const pieces=dialog.locator('[class*="segmentPiece"]');await expect(pieces.nth(1).locator('[data-segment-ruby]')).toHaveText(['b','c','d']);
 await expect(ruby('c')).toBeFocused();await expect(selected()).toHaveText(['b','c']);
 await ruby('c').press('ArrowLeft');await expect(pieces.nth(0).locator('[data-segment-ruby]')).toHaveText(['a','b','c']);await expect(ruby('c')).toBeFocused();
 await ruby('x').focus();await expect(selected()).toHaveText(['x']);
});
