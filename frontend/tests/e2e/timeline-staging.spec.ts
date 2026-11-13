import {expect,test} from '@playwright/test';
import {loadTimeline} from '../fixtures/timeline-setup';
import {importLyrics} from '../fixtures/import-lyrics';
const xml=`<tt xmlns="http://www.w3.org/ns/ttml" xmlns:studio="urn:lazulite:studio:draft"><body><div><p xml:id="stage" begin="00:00:01.000" end="00:00:08.000"><span studio:id="a" begin="00:00:01.000" end="00:00:02.000">前</span><span studio:id="b" studio:null="begin end">待分配</span><span studio:id="c" begin="00:00:05.000" end="00:00:08.000">后</span></p></div></body></tt>`;
for(const theme of ['light','dark'])test(`staging assignment, cancellation, locate and undo in ${theme}`,async({page})=>{
 await page.setViewportSize({width:1440,height:1000});await loadTimeline(page,true);
 await page.getByRole('button',{name:'编辑',exact:true}).click();
 await importLyrics(page,{name:'staging.ttml',mimeType:'application/xml',buffer:Buffer.from(xml)});
 await page.locator('[data-outline-drag]').first().click();
 await page.getByRole('button',{name:'音频处理',exact:true}).click();
 await page.evaluate(theme=>window.document.documentElement.dataset.theme=theme,theme);
 const source=page.locator('[data-staging-key="b"]');await expect(source).toBeVisible();
 const locate=page.getByRole('button',{name:'定位选区',exact:true});
 await source.press('Enter');await expect(locate).toBeDisabled();
 const lane=page.locator('[data-assignment-kind="word"]').first();
 const box=(await source.boundingBox())!,dest=(await lane.boundingBox())!;
 await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();
 await page.mouse.move(dest.x+dest.width*.2,dest.y+dest.height/2,{steps:5});
 await expect(source).toBeVisible();
 await page.keyboard.press('Escape');await page.mouse.up();await expect(source).toBeVisible();
 const again=(await source.boundingBox())!;
 await page.mouse.move(again.x+again.width/2,again.y+again.height/2);await page.mouse.down();await page.mouse.move(dest.x+dest.width*.2,dest.y+dest.height/2,{steps:5});await page.mouse.up();
 await expect(source).toHaveCount(0);await expect(page.locator('[data-timeline-key="b"]')).toBeVisible();
 await expect(locate).toBeEnabled();
 const position=await page.locator('audio').evaluate((audio:HTMLAudioElement)=>audio.currentTime);
 await locate.click();expect(await page.locator('audio').evaluate((audio:HTMLAudioElement)=>audio.currentTime)).toBe(position);
 await page.getByRole('button',{name:'撤销',exact:true}).click();await expect(source).toBeVisible();
 await page.screenshot({path:`${process.env.STUDIO_EVIDENCE_DIR??'/tmp'}/staging-${theme}.png`});
});

test('staging line drag freezes grouping and complete ancestors locate without editing',async({page})=>{
 await page.setViewportSize({width:1440,height:1000});await loadTimeline(page,true);
 await page.getByRole('button',{name:'编辑',exact:true}).click();
 await importLyrics(page,{name:'untimed.ttml',mimeType:'application/xml',buffer:Buffer.from(xml.replace('begin="00:00:01.000" end="00:00:08.000"','studio:null="begin end"'))});
 await page.getByRole('button',{name:'音频处理',exact:true}).click();await page.locator('[data-segment-id="s1"]').click();
 const source=page.locator('[data-staging-key="stage"]');await expect(source).toBeVisible();
 const from=(await source.boundingBox())!,to=(await page.locator('[data-assignment-kind="line"]').boundingBox())!;
 await page.mouse.move(from.x+from.width/2,from.y+from.height/2);await page.mouse.down();
 await expect(source).toBeVisible(); // Selecting the source row must not remove it mid-drag.
 await page.mouse.move(to.x+to.width*.2,to.y+to.height/2,{steps:5});await page.mouse.up();
 await expect(source).toHaveCount(0);await expect(page.locator('[data-staging-key="b"]')).toBeVisible();
 await page.locator('[data-segment-id="s1"]').click();await expect(source).toBeVisible();
 const position=await page.locator('audio').evaluate((a:HTMLAudioElement)=>a.currentTime);
 await source.press('Enter');await expect(source).toHaveCount(0);await expect(page.locator('[data-staging-key="b"]')).toBeVisible();
 expect(await page.locator('audio').evaluate((a:HTMLAudioElement)=>a.currentTime)).toBe(position);
 await page.getByRole('button',{name:'撤销',exact:true}).click();await expect(page.locator('[data-timeline-key="stage"]')).toHaveCount(0);
});

test('ruby and romanization assign only to corresponding lanes and remove context ancestors',async({page})=>{
 await page.setViewportSize({width:1440,height:1000});await loadTimeline(page,true);await page.getByRole('button',{name:'编辑',exact:true}).click();
 const rich=`<tt xmlns="http://www.w3.org/ns/ttml" xmlns:studio="urn:lazulite:studio:draft" xmlns:tts="http://www.w3.org/ns/ttml#styling" xmlns:itunes="http://music.apple.com/lyric-ttml-internal"><head><metadata><iTunesMetadata xmlns="http://music.apple.com/lyric-ttml-internal"><transliterations><transliteration xml:lang="ja-Latn"><text for="stage"><span studio:id="roman" begin="0" end="0" studio:null="begin end">ai</span></text></transliteration></transliterations></iTunesMetadata></metadata></head><body><div><p xml:id="stage" itunes:key="stage" begin="1" end="8"><span studio:id="parent" begin="1" end="8" tts:ruby="container"><span tts:ruby="base">愛</span><span tts:ruby="textContainer"><span studio:id="ruby" tts:ruby="text" studio:null="begin end">あい</span></span></span></p></div></body></tt>`;
 await importLyrics(page,{name:'ruby.ttml',mimeType:'application/xml',buffer:Buffer.from(rich)});await page.locator('[data-outline-drag]').first().click();await page.getByRole('button',{name:'音频处理',exact:true}).click();
 await expect(page.locator('[data-staging-key="parent"]')).toBeVisible();
 for(const [id,kind] of [['ruby','ruby'],['roman','romanization']]){
  const source=page.locator(`[data-staging-key="${id}"]`);await expect(source).toBeVisible();
  const from=(await source.boundingBox())!,wrong=(await page.locator('[data-assignment-kind="line"]').boundingBox())!;
  await page.mouse.move(from.x+from.width/2,from.y+from.height/2);await page.mouse.down();await page.mouse.move(wrong.x+wrong.width*.2,wrong.y+wrong.height/2,{steps:4});await page.mouse.up();await expect(source).toBeVisible();
  const to=(await page.locator(`[data-assignment-kind="${kind}"]`).first().boundingBox())!;
  await page.mouse.move(from.x+from.width/2,from.y+from.height/2);await page.mouse.down();await page.mouse.move(to.x+to.width*.2,to.y+to.height/2,{steps:4});await page.mouse.up();await expect(source).toHaveCount(0);
 }
 await expect(page.getByLabel('时间轴暂存区',{exact:true})).toHaveCount(0);
});
