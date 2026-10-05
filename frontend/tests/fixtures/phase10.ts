import { createLine, createLyricDocument, createWord, type RomanizationUnit } from '../../src/domain/lyric-document';
const word=(text:string,beginMs:number|null,endMs:number|null,id:string)=>({...createWord(text,id),beginMs,endMs});
const unit=(text:string,beginMs:number|null,endMs:number|null,id:string):RomanizationUnit=>({text,beginMs,endMs,id});
export function phase10Document(){
 const d=createLyricDocument();
 d.lines=[{...createLine('', 'main'),beginMs:1000,endMs:5000,words:[word(' \u3000',null,null,'lead'),word('Main',1200,1600,'m1'),word(' \u00a0',null,null,'gap'),word('lyric',2000,2600,'m2'),word('  ',null,null,'tail')]},
 {...createLine('', 'bg'),beginMs:1000,endMs:5000,backgroundOf:'main',words:[word(' ',null,null,'blead'),word('Background',1400,2800,'b1'),word('\u3000',null,null,'btail')]},
 {...createLine('', 'parallel'),beginMs:1200,endMs:4800,words:[word('Another voice',1200,4800,'p1')]}];
 d.translationTracks=[{id:'t1',language:'en',purpose:'replacement',contents:[{id:'tc1',lineId:'main',kind:'plain',text:'Translation one: literal {\\k999} \\N \\n \\h\nSecond visual line'},{id:'tc2',lineId:'main',kind:'plain',text:'Translation two, same track'}]},
 {id:'t2',language:'en',purpose:'subtitle',contents:[{id:'tc3',lineId:'bg',kind:'timed',units:[unit(' ',null,null,'tl'),unit('Outside',500,800,'tu1'),unit('\u3000\u00a0',null,null,'tg'),unit('envelope',5500,6500,'tu2'),unit(' ',null,null,'tt')]}]}];
 d.romanizationTracks=[{id:'r1',language:'en',contents:[{id:'rc1',lineId:'main',kind:'timed',units:[unit('roman-main',1200,1600,'ru1'),unit(' ',null,null,'rg'),unit('roman-lyric',2000,2600,'ru2')]}]},
 {id:'r2',language:'en',contents:[{id:'rc2',lineId:'main',kind:'plain',text:'Another romanization'}]}];
 return d;
}
