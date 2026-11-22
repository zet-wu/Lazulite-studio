import {expect,it} from 'vitest';
import {createLyricDocument,createWord} from '../src/domain/lyric-document';
import {prepareTimelineAssignment,applyTimelineAssignment,snapTimelineInterval,moveTimeline} from '../src/domain/timeline-editing';
import {lyricSnapAnchors,stableSnapAnchor,targetId} from '../src/features/editor/selection-targets';
function fixture(){
 const doc=createLyricDocument('a'),line=doc.lines[0],word=line.words[0];
 line.beginMs=500;line.endMs=2500;word.beginMs=1000;word.endMs=2000;
 word.rubyUnits=[{id:'missing',reading:'a',beginMs:null,endMs:null},{id:'timed',reading:'b',beginMs:1500,endMs:1700}];
 return {doc,line,word,target:{kind:'ruby' as const,lineId:line.id,wordId:word.id,rubyId:'missing'}};
}
it('allocates ancestor first and last gaps, whole ancestors and ruby fallback sides from real containment',()=>{
 const {doc,line,word,target}=fixture();
 expect(prepareTimelineAssignment(doc,target,1200,5000)).toMatchObject({beginMs:1000,endMs:1500,fixed:true});
 expect(prepareTimelineAssignment(doc,target,1900,5000)).toMatchObject({beginMs:1700,endMs:2000,fixed:true});
 word.rubyUnits.pop();
 expect(prepareTimelineAssignment(doc,target,1200,5000)).toMatchObject({beginMs:1000,endMs:2000,fixed:true});
 word.beginMs=null;
 expect(prepareTimelineAssignment(doc,target,1200,5000)).toMatchObject({beginMs:500,endMs:2000});
 word.endMs=null;line.endMs=null;
 expect(prepareTimelineAssignment(doc,target,1200,5000)).toMatchObject({beginMs:500,endMs:800,fixed:true});
 line.beginMs=null;line.endMs=2500;
 expect(prepareTimelineAssignment(doc,target,1200,5000)).toMatchObject({beginMs:2200,endMs:2500,fixed:true});
});
it('external drops may extend ancestors; fixed assignments cannot slide and invalid assignments cannot snap into validity',()=>{
 const {doc,word,target}=fixture();
 const outer=applyTimelineAssignment(doc,target,prepareTimelineAssignment(doc,target,2600,5000));
 expect(outer.lines[0]).toMatchObject({endMs:2800});
 expect(outer.lines[0].words[0].rubyUnits[1]).toEqual(word.rubyUnits[1]);
 const assignment=prepareTimelineAssignment(doc,target,1200,5000);
 expect(()=>applyTimelineAssignment(doc,target,assignment,10)).toThrow();
 expect(()=>applyTimelineAssignment(doc,target,prepareTimelineAssignment(doc,target,5000,5000))).toThrow();
});
it('free intervals snap by end inside ancestor bounds, checking other candidates after an invalid nearest',()=>{
 const {doc,word,target}=fixture();word.rubyUnits[1].beginMs=1000;word.rubyUnits[1].endMs=1400;
 // Inside an occupied sibling: average allocation remains free and may overlap.
 const assignment=prepareTimelineAssignment(doc,target,1210,5000);
 expect(assignment).toMatchObject({beginMs:1210,endMs:1610,fixed:false});
 const shift=snapTimelineInterval(1210,1610,[1600],1000,640,true,delta=>{applyTimelineAssignment(doc,target,assignment,delta);return true;});
 expect(shift).toBe(-10);
 expect(applyTimelineAssignment(doc,target,assignment,shift).lines[0].words[0].rubyUnits[0]).toMatchObject({beginMs:1200,endMs:1600});
 const edge={...assignment,beginMs:1000,endMs:1400};
 expect(snapTimelineInterval(1000,1400,[999,1404],1000,640,true,delta=>{try{applyTimelineAssignment(doc,target,edge,delta);return true;}catch{return false;}})).toBe(4);
 expect(snapTimelineInterval(1210,1610,[1600],1000,640,false)).toBe(0);
});
it('preserves timed descendants during staging while main movement shifts descendants',()=>{
 const {doc,line,word}=fixture();word.beginMs=null;word.endMs=null;
 const target={kind:'word' as const,lineId:line.id,wordId:word.id};line.beginMs=null;line.endMs=null;
 const assignment=prepareTimelineAssignment(doc,target,1510,5000);
 expect(assignment).toMatchObject({beginMs:1500,endMs:1810,childBegin:1500,childEnd:1700});
 expect(()=>applyTimelineAssignment(doc,target,assignment,1)).toThrow();
 const staged=applyTimelineAssignment(doc,target,assignment,-10);
 expect(staged.lines[0].words[0].rubyUnits).toEqual(word.rubyUnits);
 const moved=moveTimeline(staged,[target],100);
 expect(moved.lines[0].words[0].rubyUnits[1]).toMatchObject({beginMs:1600,endMs:1800});
 expect(moved.lines[0].words[0].rubyUnits[0].beginMs).toBeNull();
});
it('orders zero, nearest end, equal-distance start, candidate times, and legal alternatives deterministically',()=>{
 expect(snapTimelineInterval(100,200,[200,101],1000,640,true)).toBe(0);
 expect(snapTimelineInterval(100,200,[104,202],1000,640,true)).toBe(2);
 expect(snapTimelineInterval(100,200,[198,102],1000,640,true)).toBe(2);
 expect(snapTimelineInterval(100,200,[102,98],1000,640,true)).toBe(-2);
 expect(snapTimelineInterval(100,200,[101,203],1000,640,true,delta=>delta!==1)).toBe(3);
 expect(snapTimelineInterval(100,200,[101],1000,640,true,()=>false)).toBe(0);
});
it('excludes changed endpoint identities without losing independent same-time boundaries',()=>{
 const {doc,line,word}=fixture();line.words.push({...createWord('independent'),beginMs:1000,endMs:2000});
 const target={kind:'word' as const,lineId:line.id,wordId:word.id};
 const after=moveTimeline(doc,[target],100);
 const options=lyricSnapAnchors(doc,after,item=>targetId(item)===word.id||item.kind==='ruby'&&item.wordId===word.id,[]);
 expect(options.some(anchor=>anchor.time===1000&&anchor.target?.kind==='word')).toBe(true);
 expect(options.every(anchor=>stableSnapAnchor(anchor,after))).toBe(true);
 const changed=structuredClone(after);changed.lines[0].words[1].beginMs=990;
 const independent=options.find(anchor=>anchor.time===1000&&anchor.target?.kind==='word')!;
 expect(stableSnapAnchor(independent,changed)).toBe(false);
});
it('considers an ancestor endpoint that becomes stable only in the final snapped candidate',()=>{
 const {doc,line,word,target}=fixture();line.beginMs=null;line.endMs=2000;word.beginMs=1000;word.endMs=2000;
 word.rubyUnits[1].beginMs=1500;word.rubyUnits[1].endMs=1900;
 const assignment=prepareTimelineAssignment(doc,target,2010,5000),base=applyTimelineAssignment(doc,target,assignment);
 expect(base.lines[0].words[0].endMs).toBe(2410);
 const anchors=lyricSnapAnchors(doc,null,item=>targetId(item)===target.rubyId,[]);
 const boundary=anchors.findIndex(anchor=>anchor.target?.kind==='word'&&anchor.side==='endMs');
 expect(stableSnapAnchor(anchors[boundary],base)).toBe(false);
 const next=applyTimelineAssignment(doc,target,assignment,-410);
 expect(stableSnapAnchor(anchors[boundary],next)).toBe(true);
});
