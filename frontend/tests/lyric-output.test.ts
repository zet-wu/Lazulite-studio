import {expect,it} from 'vitest';
import {createLyricDocument,createLine} from '../src/domain/lyric-document';
import {createProjectDocument} from '../src/domain/project-document';
import {outputId} from '../src/domain/karaoke';
import {prepareLyricDownload} from '../src/adapters/lyric-output';
function fixture(){
 const lyrics=createLyricDocument('正文'),line=lyrics.lines[0];Object.assign(line,{beginMs:1000,endMs:2000});Object.assign(line.words[0],{beginMs:1000,endMs:2000});
 const bg=createLine(' 背景 ');bg.backgroundOf=line.id;Object.assign(bg,{beginMs:1500,endMs:2500});Object.assign(bg.words[0],{beginMs:1500,endMs:2500});lyrics.lines.push(bg);
 lyrics.translationTracks=[{id:'tr',language:'en',purpose:'subtitle',contents:[{id:'translation',lineId:line.id,kind:'plain',text:'Translation'},{id:'bg-translation',lineId:bg.id,kind:'plain',text:'Background'}]}];
 lyrics.romanizationTracks=[{id:'ro',language:'ja-Latn',contents:[{id:'roman',lineId:line.id,kind:'timed',units:[{id:'unit',text:'uta',beginMs:3000,endMs:4000}]}]}];return createProjectDocument(lyrics);
}
it('uses selected display order for TXT and stable time order for LRC without mutating lyrics',()=>{
 const p=fixture(),snapshot=JSON.stringify(p);p.karaoke.outputs.push(outputId('main','translation','tr'),outputId('main','romanization','ro'),outputId('background','translation','tr'));const configured=JSON.stringify(p);
 const txt=prepareLyricDownload(p,'txt','歌');expect(txt.issues).toEqual([]);expect(txt.files[0].text).toBe('正文\nTranslation\nuta\n（ 背景 ）\n（Background）\n');
 const lrc=prepareLyricDownload(p,'lrc','歌');expect(lrc.issues).toEqual([]);expect(lrc.files[0].text).toContain('[00:01.000]Translation');expect(lrc.files[0].text.indexOf('（Background）')).toBeLessThan(lrc.files[0].text.indexOf('uta'));
 expect(JSON.stringify(p)).toBe(configured);expect(snapshot).not.toBe(configured);
});
it.each(['lrc','elrc','eslrc','qrc','yrc','lys','ass'] as const)('timed attachment only has its own endpoints in %s',format=>{
 const p=fixture();p.karaoke.outputs=[outputId('main','romanization','ro')];p.lyrics.lines[0].beginMs=null;p.lyrics.lines[0].endMs=null;p.lyrics.lines[0].words[0].beginMs=null;
 const result=prepareLyricDownload(p,format,'歌');expect(result.issues).toEqual([]);expect(result.files[0].text).toContain('uta');expect(result.files[0].text).not.toContain('正文');
});
it('plain extended LRC remains line timed and full timed formats locate the borrowed missing endpoint',()=>{
 const p=fixture();p.karaoke.outputs=[outputId('main','translation','tr')];p.lyrics.lines[0].endMs=null;
 expect(prepareLyricDownload(p,'elrc','歌').files[0].text).toBe('[00:01.000]Translation\n');
 const result=prepareLyricDownload(p,'qrc','歌');expect(result.files).toEqual([]);expect(result.issues[0]).toMatchObject({lineId:p.lyrics.lines[0].id,kind:'line',missing:['end']});
});
it('unselected backgrounds do not block and TTML always exports the full structure',()=>{
 const p=fixture();p.karaoke.outputs=[outputId('main')];p.lyrics.lines[1].beginMs=null;
 expect(prepareLyricDownload(p,'qrc','歌').issues).toEqual([]);expect(prepareLyricDownload(p,'qrc','歌').files[0].text).not.toContain('背景');
 const ttml=prepareLyricDownload(p,'ttml','歌');expect(ttml.files[0].text).toContain('x-bg');expect(ttml.files[0].text).toContain('Translation');
 p.karaoke.outputs=[];expect(prepareLyricDownload(p,'txt','歌').issues[0].karaokeSettings).toBe(true);
});
it('attachment timing errors map to their actual editor unit',()=>{
 const p=fixture();p.karaoke.outputs=[outputId('main','romanization','ro')];const content=p.lyrics.romanizationTracks[0].contents[0];if(content.kind==='timed')content.units[0].endMs=null;
 expect(prepareLyricDownload(p,'yrc','歌').issues).toContainEqual(expect.objectContaining({kind:'romanization-unit',lineId:p.lyrics.lines[0].id,trackId:'ro',contentId:'roman',unitId:'unit'}));
});
