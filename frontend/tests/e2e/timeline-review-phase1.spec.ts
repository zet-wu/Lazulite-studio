import { expect, test } from '@playwright/test';
import { loadTimeline } from '../fixtures/timeline-setup';
import { importLyrics } from '../fixtures/import-lyrics';
const fixture = `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" xmlns:tts="http://www.w3.org/ns/ttml#styling"><head><metadata><iTunesMetadata xmlns="http://music.apple.com/lyric-ttml-internal"><translations><translation type="replacement" xml:lang="zh-Hant"><text for="a"><span begin="1.000" end="2.000"> 譯文 </span></text></translation></translations><transliterations><transliteration xml:lang="ja-Latn"><text for="a"><span begin="1.000" end="2.000">a </span></text><text for="b"><span begin="4.000" end="5.000">b </span></text></transliteration></transliterations></iTunesMetadata></metadata></head><body><p xml:id="a" begin="1.000" end="3.000"><span begin="1.000" end="2.000">甲</span><span begin="2.000" end="3.000">乙</span><span ttm:role="x-bg" begin="2.000" end="3.000"><span begin="2.000" end="3.000">(背景)</span></span></p><p xml:id="b" begin="4.000" end="6.000"><span begin="4.000" end="5.000">丙</span><span begin="5.000" end="6.000">丁</span></p></body></tt>`;
async function setup(page: import('@playwright/test').Page) {
 await loadTimeline(page);
 await importLyrics(page, { name: 'timeline-review.ttml', mimeType: 'application/xml', buffer: Buffer.from(fixture) });
 await page.getByRole('button', { name: '时间轴行 L1', exact: true }).click();
}
test('shared multi-line and child selection, envelope capture, independent romanization layer and background activation', async ({page}) => {
 await setup(page);
 await page.getByRole('button', { name: '时间轴行 L2', exact: true }).click({ modifiers: ['Control'] });
 await expect(page.getByRole('button', { name: '时间轴词 甲', exact: true })).toBeVisible();
 await expect(page.getByRole('button', { name: '时间轴词 丙', exact: true })).toBeVisible();
 await page.getByRole('button', { name: '时间轴词 甲', exact: true }).click();
 await page.getByRole('button', { name: '时间轴词 丙', exact: true }).click({ modifiers: ['Control'] });
 await expect(page.getByText('词已选 2', { exact: true })).toBeVisible();
 await expect(page.locator('[data-outline-drag][aria-pressed="true"]')).toHaveCount(0);
 await page.getByRole('button', { name: '循环选区', exact: true }).click();
 await expect(page.getByRole('button', { name: '循环 A/B', exact: true })).toHaveClass(/active/);
 await page.getByRole('button', { name: '音译', exact: true }).click();
 await expect(page.getByRole('button', { name: /^时间轴音译/ })).toHaveCount(0);
 await expect(page.getByRole('button', { name: '时间轴词 甲', exact: true })).toBeVisible();
 await page.getByRole('button', { name: '时间轴行 L1 背景', exact: true }).click();
 await expect(page.getByRole('button', { name: '时间轴词 背景', exact: true })).toBeVisible();
 await expect(page.getByRole('button', { name: '时间轴词 甲', exact: true })).toHaveCount(0);
});
test('timed romanization drag preserves body and translation; translation fields preserve units and select their independent timed objects', async ({page}) => {
 await setup(page);
 await page.getByLabel('吸附', { exact: true }).uncheck();
 const roman = page.getByRole('button', { name: /^时间轴音译/ }).first();
 const before = (await roman.boundingBox())!;
 await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2); await page.mouse.down();
 await page.mouse.move(before.x + before.width / 2 + 25, before.y + before.height / 2, {steps:4}); await page.mouse.up();
 await expect(page.getByRole('textbox', {name:'行 a开始秒数',exact:true})).toHaveCount(0);
 await page.locator('[data-line-id="a"] > [data-outline-drag]').click();
 await expect(page.getByRole('textbox', {name:'行 a开始秒数',exact:true})).toHaveValue('1');
 await expect(page.getByRole('spinbutton', {name:'翻译 1 单元 1 开始毫秒',exact:true})).toHaveValue('1000');
 await page.getByRole('button',{name:'撤销',exact:true}).click();
 expect((await roman.boundingBox())!.x).toBeCloseTo(before.x, 0);
 const text = page.getByRole('textbox',{name:'翻译 1 单元 1',exact:true});
 await text.fill(' 新譯文 '); await text.press('Enter');
 await expect(page.getByRole('button',{name:'循环选区',exact:true})).toBeEnabled();
 await expect(text).toHaveValue(' 新譯文 ');
 await page.getByRole('button',{name:'撤销',exact:true}).click();
 await expect(text).toHaveValue(' 譯文 ');
 await text.fill('取消'); await text.press('Escape'); await expect(text).toHaveValue(' 譯文 ');
});
test('timeline context menu preserves multi-selection and Delete shares atomic history with the canvas', async ({page}) => {
 await setup(page);
 await page.getByRole('button',{name:'时间轴行 L2',exact:true}).click({modifiers:['Control']});
 const first=page.getByRole('button',{name:'时间轴词 甲',exact:true}), last=page.getByRole('button',{name:'时间轴词 丙',exact:true});
 await first.click(); await last.click({modifiers:['Shift']});
 await expect(page.getByText('词已选 4',{exact:true})).toBeVisible(); // Includes the explicit background in document order.
 await first.click({button:'right'});
 await page.getByRole('menuitem',{name:'复制',exact:true}).click();
 await expect(page.getByText('词已选 4',{exact:true})).toBeVisible();
 await first.focus(); await page.keyboard.press('Delete');
 await expect(page.locator('main [data-word-id]')).toHaveCount(1);
 await page.getByRole('button',{name:'撤销',exact:true}).click();
 await expect(page.locator('main [data-word-id]')).toHaveCount(5);
});
test('segment selections replace lyric targets, loop their envelope and retain expanded lyric groups', async ({page}) => {
 await loadTimeline(page,true,[{id:'s1',beginMs:1000,endMs:3000},{id:'s2',beginMs:5000,endMs:7000}]);
 await page.locator('[data-segment-id="s1"]').click(); await page.locator('[data-segment-id="s2"]').click({modifiers:['Control']});
 await expect(page.locator('[data-segment-id][aria-pressed="true"]')).toHaveCount(2);
 await page.getByRole('button',{name:'循环选区',exact:true}).click();
 await expect(page.getByRole('button',{name:'A 00:01.000',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'B 00:07.000',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'时间轴词 上',exact:true}).click();
 await expect(page.locator('[data-segment-id][aria-pressed="true"]')).toHaveCount(0);
 await expect(page.getByRole('button',{name:'A 00:01.000',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'B 00:07.000',exact:true})).toBeVisible();
});
test('all expanded rows remain selected while child groups mount only near the vertical viewport', async ({page}) => {
 await loadTimeline(page);
 const xml='<tt xmlns="http://www.w3.org/ns/ttml"><body>'+Array.from({length:2000},(_,i)=>`<p xml:id="l${i}" begin="${i*.02}" end="${i*.02+.01}"><span begin="${i*.02}" end="${i*.02+.01}">行${i}</span></p>`).join('')+'</body></tt>';
 await importLyrics(page,{name:'many.ttml',mimeType:'application/xml',buffer:Buffer.from(xml)});
 await page.locator('[data-outline-drag]').first().click(); await page.keyboard.press('Control+a');
 await expect(page.getByText('行已选 2000',{exact:true})).toBeVisible();
 const groups=page.getByRole('region',{name:/子轨$/});
 expect(await groups.count()).toBeLessThan(30); expect(await groups.count()).toBeGreaterThan(0);
 await groups.first().locator('..').locator('..').evaluate(element=>{element.scrollTop=element.scrollHeight;});
 await expect(page.getByRole('region',{name:'L2000 子轨',exact:true})).toBeVisible();
 await expect(page.getByText('行已选 2000',{exact:true})).toBeVisible();
 await page.screenshot({path:test.info().outputPath('expanded-2000.png')});
});
test('Ruby range and reverse marquee resolve different word owners and undo one grouped delete', async ({page}) => {
 await loadTimeline(page);
 const ruby=page.getByRole('button',{name:/^时间轴注音 /});
 await ruby.first().click(); await ruby.last().click({modifiers:['Shift']});
 await expect(page.getByText('注音已选 3',{exact:true})).toBeVisible();
 await ruby.first().click(); await expect(page.getByText('注音已选 3',{exact:true})).toBeVisible();
 const lane=ruby.first().locator('..');const box=(await lane.boundingBox())!;
 await page.keyboard.down('Shift');await page.mouse.move(box.x+box.width*.9,box.y+box.height-1);await page.mouse.down();
 await page.mouse.move(box.x+.1,box.y+box.height-1,{steps:5});await page.mouse.up();await page.keyboard.up('Shift');
 await expect(page.getByText('注音已选 3',{exact:true})).toBeVisible();
 await ruby.first().focus();await page.keyboard.press('Delete');await expect(page.locator('main [data-ruby-id]')).toHaveCount(0);
 await page.getByRole('button',{name:'撤销',exact:true}).click();await expect(page.locator('main [data-ruby-id]')).toHaveCount(3);
});
test('romanization selection across contents disables partial copy and deletes all owners once', async ({page}) => {
 await setup(page);await page.getByRole('button',{name:'时间轴行 L2',exact:true}).click({modifiers:['Control']});
 const roman=page.getByRole('button',{name:/^时间轴音译 /});
 await roman.first().click();await roman.last().click({modifiers:['Shift']});
 await expect(page.getByText('音译单元已选 2',{exact:true})).toBeVisible();
 await roman.first().click({button:'right'});await expect(page.getByRole('menuitem',{name:'复制',exact:true})).toBeDisabled();
 await page.getByRole('menuitem',{name:/删除所选单元/}).click();await expect(roman).toHaveCount(0);
 await page.getByRole('button',{name:'撤销',exact:true}).click();await expect(roman).toHaveCount(2);
});
