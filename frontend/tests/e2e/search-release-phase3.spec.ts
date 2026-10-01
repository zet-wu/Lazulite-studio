import {expect,test} from '@playwright/test';
import {importLyrics} from '../fixtures/import-lyrics';
const source=`<tt xmlns="http://www.w3.org/ns/ttml"><head><metadata><iTunesMetadata xmlns="http://music.apple.com/lyric-ttml-internal"><transliterations><transliteration xml:lang="ja-Latn"><text for="L1"><span begin="1">uta</span></text></transliteration></transliterations></iTunesMetadata></metadata></head><body><p xml:id="L1" begin="1" end="4"><span begin="2" end="3">歌</span><span begin="1" end="2">声</span></p></body></tt>`;
async function open(page:import('@playwright/test').Page){await page.goto('/editor');await importLyrics(page,{name:'phase3.ttml',mimeType:'application/xml',buffer:Buffer.from(source)});await page.getByRole('button',{name:'文件打包',exact:true}).click();}
test('auto checks and replaces operation blockers without restricting plain text',async({page})=>{
 await open(page);await expect(page.getByRole('heading',{name:'TTML 校验'})).toBeVisible();
 const problem=page.getByRole('button',{name:/音译第 1 单元：缺少结束时间/});await expect(problem).toBeVisible();
 await expect(page.locator('[data-blocking=true]')).toHaveCount(0);
 await page.getByRole('button',{name:'下载歌词',exact:true}).click();await expect(page.locator('[data-blocking=true]')).toHaveCount(1);
 await page.getByLabel('导出格式').selectOption('txt');await expect(page.locator('[data-blocking=true]')).toHaveCount(0);
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'下载歌词',exact:true}).click();await download;
 await page.getByLabel('导出格式').selectOption('elrc');await page.getByRole('button',{name:'下载歌词',exact:true}).click();
 await expect(page.locator('[data-blocking=true]').getByRole('button',{name:/第 2 词/})).toBeVisible();
 await expect(problem).not.toHaveAttribute('aria-description',/本次操作受阻/);
 await problem.focus();await page.keyboard.press('Enter');await expect(page.getByRole('button',{name:'编辑',exact:true})).toHaveAttribute('aria-current','page');
});
for(const width of [1280,1440,1920])for(const theme of ['light','dark'])test(`validation layout ${width} ${theme}`,async({page})=>{
 await page.setViewportSize({width,height:900});await page.addInitScript(theme=>localStorage.setItem('lazulite-editor-theme',theme),theme);
 await open(page);await expect(page.getByRole('button',{name:'下载歌词',exact:true})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
 await page.screenshot({path:test.info().outputPath(`validation-${width}-${theme}.png`)});
});
