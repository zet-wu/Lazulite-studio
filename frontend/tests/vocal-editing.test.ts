import { expect, it } from 'vitest';
import { createLyricDocument, createLine, createWord } from '../src/domain/lyric-document';
import { assignVocalSegment, AssignmentError, editSegments } from '../src/domain/vocal-editing';
const segment = { id:'s', beginMs:30000, endMs:32000 };
function fixture(){
 const doc=createLyricDocument('歌'), line=doc.lines[0];line.id='a';line.beginMs=10000;line.endMs=14000;
 line.words=[{...createWord('歌','w'),beginMs:11000,endMs:13000,rubyUnits:[{id:'r',reading:'うた',beginMs:11500,endMs:null}],alignmentUnits:[{id:'u',kind:'mora',text:'う',beginMs:null,endMs:12500,readingStart:null,readingEnd:null,rubyUnitId:'r'}]}];
 doc.romanizationTracks=[{id:'t',language:'ja-Latn',contents:[{id:'c',lineId:'a',kind:'timed',units:[{id:'ru',text:'uta',beginMs:11500,endMs:13000}]}]}];
 return doc;
}
it('moves every known endpoint by the same delta without scaling or filling unknown ends',()=>{
 const doc=fixture(),next=assignVocalSegment(doc,'a',segment,60000);
 expect(next.lines[0]).toMatchObject({beginMs:30000,endMs:34000,words:[{beginMs:31000,endMs:33000,rubyUnits:[{beginMs:31500,endMs:null}],alignmentUnits:[{beginMs:null,endMs:32500}]}]});
 expect(next.romanizationTracks[0].contents[0]).toMatchObject({units:[{beginMs:31500,endMs:33000}]});
 doc.lines[0].endMs=null;expect(assignVocalSegment(doc,'a',segment,60000).lines[0].endMs).toBeNull();
 doc.lines[0].beginMs=null;doc.lines[0].endMs=14000;
 expect(assignVocalSegment(doc,'a',segment,60000).lines[0]).toMatchObject({beginMs:null,endMs:32000,words:[{beginMs:29000,endMs:31000}]});
});
it('only all-unknown rows receive both segment endpoints',()=>{
 const doc=fixture();doc.lines[0].beginMs=null;doc.lines[0].endMs=null;
 expect(()=>assignVocalSegment(doc,'a',segment,60000)).toThrow(AssignmentError);
 const unknown=createLyricDocument('未知');const next=assignVocalSegment(unknown,unknown.lines[0].id,segment,60000);
 expect(next.lines[0]).toMatchObject({beginMs:30000,endMs:32000,words:[{beginMs:null,endMs:null}]});
});
it('freezes incoming links, unlinks outgoing, leaves backgrounds and unrelated links untouched',()=>{
 const doc=fixture();doc.lines.push({...createLine('来源','in'),beginMs:0,endMs:10000,endLink:{targetLineId:'a'}},{...createLine('目标','out'),beginMs:14000,endMs:18000},{...createLine('背景','bg'),beginMs:10000,endMs:14000,backgroundOf:'a'});
 doc.lines[0].endLink={targetLineId:'out'};
 const next=assignVocalSegment(doc,'a',segment,60000);
 expect(next.lines[0].endLink).toBeNull();expect(next.lines[1]).toMatchObject({beginMs:0,endMs:10000,endLink:null});
 expect(next.lines[2]).toBe(doc.lines[2]);expect(next.lines[3]).toBe(doc.lines[3]);
 const bg=assignVocalSegment(doc,'bg',segment,60000);expect(bg.lines[0]).toBe(doc.lines[0]);
 expect(()=>assignVocalSegment(doc,'a',segment,33000)).toThrow();expect(doc.lines[0].endLink).toEqual({targetLineId:'out'});
});
it('accepts exact song endpoints and rejects every moved internal outlier atomically',()=>{
 const doc=fixture();doc.lines[0].words[0].rubyUnits[0].beginMs=500;
 expect(()=>assignVocalSegment(doc,'a',{id:'s',beginMs:0,endMs:2000},60000)).toThrow(AssignmentError);
 const error=(()=>{try{assignVocalSegment(doc,'a',{id:'s',beginMs:0,endMs:2000},60000);}catch(e){return e as AssignmentError;}})();
 expect(error?.objectIds).toContain('r');
 const regular=fixture();expect(assignVocalSegment(regular,'a',{id:'s',beginMs:0,endMs:2000},4000).lines[0]).toMatchObject({beginMs:0,endMs:4000});
});
it('merges only consecutive time-ordered selections and never edits lyrics',()=>{
 const acoustics={analysisId:'r',segments:[{id:'a',beginMs:0,endMs:1000},{id:'b',beginMs:900,endMs:1200},{id:'c',beginMs:2000,endMs:2500}]};
 expect(()=>editSegments(acoustics,{type:'merge',ids:['a','c']},3000)).toThrow();
 const next=editSegments(acoustics,{type:'merge',ids:['a','b']},3000);expect(next.segments).toContainEqual({id:'a',beginMs:0,endMs:1200});expect(next.analysisId).toBe('r');
 expect(editSegments(next,{type:'delete',ids:['a']},3000).segments).toEqual([acoustics.segments[2]]);
 expect(()=>editSegments(next,{type:'put',segment:{id:'z',beginMs:2,endMs:2}},3000)).toThrow();
});
