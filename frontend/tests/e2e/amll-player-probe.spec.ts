import {expect,test} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
test('records actual core 0.5.2 Studio projection and player grouping',async({page})=>{
 await page.goto('/projects/sample-project/edit?scenario=no-music');
 const report=await page.evaluate(async xml=>{
  const codecPath='/src/adapters/ttml/lyric-codec.ts',projectionPath='/src/domain/preview-adapter.ts',playerPath='/src/features/editor/StudioLyricPlayer.ts';
  const codec=await import(codecPath),projection=await import(projectionPath),module=await import(playerPath);
  const doc=codec.parseLyricTtml(xml),lines=projection.toAmllLines(doc,true,true);
  const player=new module.StudioLyricPlayer();document.body.appendChild(player.getElement());player.setLyricLines(lines.map((item: {lyric:unknown})=>item.lyric));
  const groups=player.currentLyricGroups.map((group:{mainLine:{getLine:()=>{words:{word:string}[]}};bgLine?:{getLine:()=>{words:{word:string}[]}}})=>({main:group.mainLine.getLine().words.map(w=>w.word).join(''),background:group.bgLine?.getLine().words.map(w=>w.word).join('')}));
  player.dispose();return {version:'@applemusic-like-lyrics/core 0.5.2',input:lines.map((item:{id:string})=>item.id),groups};
 },readFileSync('../tests/fixtures/ttml/amll-phase0-rich.ttml','utf8'));
 writeFileSync('/tmp/amll-player.json',JSON.stringify(report,null,2));expect(report.input).toEqual(['main','bg1','bg2','next']);expect(report.groups.length).toBeGreaterThan(0);
});
