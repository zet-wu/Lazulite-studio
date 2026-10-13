import { expect, test } from 'vitest';
import { collectOutputIssues } from '../src/adapters/output-validation';
import { createLyricDocument, createLine, createWord } from '../src/domain/lyric-document';
test('issues use visible main/background ordinals, stable object IDs and duplicate track numbers',()=>{
 const d=createLyricDocument(),main=createLine('x'), bg=createLine('bg'),next=createLine('next');bg.backgroundOf=main.id;d.lines=[main,bg,next];
 main.words[0].rubyUnits=[{id:'ruby',reading:'r',beginMs:null,endMs:null}];
 d.romanizationTracks=['t1','t2'].map(id=>({id,language:'ja-Latn',contents:[{id:`${id}c`,lineId:next.id,kind:'timed',units:[{id:`${id}u`,text:'text',beginMs:null,endMs:null}]}]}));
 const issues=[...collectOutputIssues(d,'qrc'),...collectOutputIssues(d,'ttml')];
 expect(issues.some(i=>i.lineId===bg.id && i.message.startsWith('第 1 行 · 背景'))).toBe(true);
 expect(issues.some(i=>i.rubyId==='ruby')).toBe(false);
 expect(issues.find(i=>i.trackId==='t2')?.message).toBe('第 2 行 · ja-Latn 轨道 2 音译第 1 单元：缺少开始和结束时间');
 expect(issues.every(i=>!i.message.includes(main.id) && !i.message.includes('text'))).toBe(true);
 expect(collectOutputIssues(d,'lrc').every(i=>i.kind==='line' && i.lineId!==bg.id)).toBe(true);
 expect(collectOutputIssues(d,'ttml').map(i=>i.kind)).toEqual(['romanization-unit','romanization-unit']);
});
test('blank romanization exception is precise and format validation ignores unwritten tracks',()=>{
 const d=createLyricDocument('x');d.lines[0].beginMs=0;d.lines[0].endMs=1000;
 d.lines[0].words=[{...createWord('x'),beginMs:0,endMs:1000}];
 d.romanizationTracks=[{id:'t',language:null,contents:[{id:'c',lineId:d.lines[0].id,kind:'timed',units:[{id:'u',text:' ',beginMs:null,endMs:null}]}]}];
 expect(collectOutputIssues(d,'ttml')).toEqual([]);
 const c=d.romanizationTracks[0].contents[0];if(c.kind!=='timed')throw new Error('fixture');c.units[0].beginMs=0;
 expect(collectOutputIssues(d,'ttml')[0].missing).toEqual(['end']);expect(collectOutputIssues(d,'lrc')).toEqual([]);
});
