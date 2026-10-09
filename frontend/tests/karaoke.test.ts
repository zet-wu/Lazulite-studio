import { expect, it } from 'vitest';
import { createLine, createLyricDocument, createWord } from '../src/domain/lyric-document';
import { createProjectDocument, createProjectEditorState, executeProjectCommand, undoProjectCommand } from '../src/domain/project-document';
import { anchorRange, autoInsertCues, cueProblem, insertCue, reconcileKaraoke, applyKaraoke } from '../src/domain/karaoke';
import { parseProject, serializeProject } from '../src/adapters/project-codec';
export function fixture() {
 const lyrics=createLyricDocument('愛'); const line=lyrics.lines[0]; line.beginMs=4000;line.endMs=7000;
 line.words=[{...createWord('愛','a'),beginMs:4000,endMs:5000,rubyUnits:[{id:'r1',reading:'あ',beginMs:4200,endMs:4300},{id:'r2',reading:'い',beginMs:4900,endMs:5000}]},{...createWord('●','b'),beginMs:5600,endMs:7000}];
 return createProjectDocument(lyrics);
}
it('keeps cues outside TTML, round trips project and undoes a whole auto insertion',()=>{
 const p=fixture(), state=createProjectEditorState(p);
 const next=executeProjectCommand(state,{type:'karaoke',command:{kind:'auto',groupIds:['main'],thresholds:p.karaoke.defaults}});
 expect(next.present.karaoke.cues).toHaveLength(3);
 expect(serializeProject(next.present).lyrics.draftTtml).toBe(serializeProject(p).lyrics.draftTtml);
 expect(parseProject(serializeProject(next.present))).toEqual(next.present);
 expect(undoProjectCommand(next).present).toBe(p);
 expect(autoInsertCues(p.lyrics,next.present.karaoke).cues).toEqual(next.present.karaoke.cues);
});
it('strict thresholds preserve short manual slots; curve head never creates zero duration',()=>{
 const p=fixture();p.karaoke.defaults={...p.karaoke.defaults,beforeMs:4000,wordMs:600,rubyMs:600};
 expect(autoInsertCues(p.lyrics,p.karaoke).cues).toHaveLength(0);
 const a={kind:'before' as const,lineId:p.lyrics.lines[0].id};
 for(let i=0;i<4;i++)p.karaoke=insertCue(p.lyrics,p.karaoke,a);
 expect(()=>insertCue(p.lyrics,p.karaoke,a)).toThrow('曲头');
 expect(p.karaoke.cues.map(c=>[c.beginMs,c.endMs])).toEqual([[3000,4000],[2000,3000],[1000,2000],[0,1000]]);
});
it('retiming preserves manually shortened cue and reports range; deletion and undo are atomic',()=>{
 let state=createProjectEditorState(fixture()); const line=state.present.lyrics.lines[0];
 state=executeProjectCommand(state,{type:'karaoke',command:{kind:'insert',anchor:{kind:'word',lineId:line.id,leftId:'a',rightId:'b'}}});
 const cue=state.present.karaoke.cues[0];
 state=executeProjectCommand(state,{type:'karaoke',command:{kind:'cue',id:cue.id,text:'●●●',beginMs:5100,endMs:5500}});
 const changed=structuredClone(state.present.lyrics);changed.lines[0].words[1].beginMs=5400;
 const next=executeProjectCommand(state,{type:'lyrics',command:{type:'replace-document',document:changed}});
 expect(next.present.karaoke.cues[0].endMs).toBe(5500);
 expect(cueProblem(changed,next.present.karaoke,next.present.karaoke.cues[0])).toContain('双端');
 const deleted=structuredClone(changed);deleted.lines[0].words.pop();
 const result=executeProjectCommand(next,{type:'lyrics',command:{type:'replace-document',document:deleted}});
 expect(result.present.karaoke.cues).toHaveLength(0);expect(undoProjectCommand(result).present).toBe(next.present);
});
it('moves adjacent anchors to their new line, removes broken adjacency and preserves assignments',()=>{
 const p=fixture();p.karaoke=autoInsertCues(p.lyrics,p.karaoke);
 const next=structuredClone(p.lyrics), other=createLine('');other.words=next.lines[0].words;next.lines[0].words=[];next.lines.push(other);
 const moved=reconcileKaraoke(next,p.karaoke);expect(moved.cues.filter(c=>c.anchor.kind!=='before').every(c=>c.anchor.lineId===other.id)).toBe(true);
 other.words.splice(1,0,createWord('x'));expect(reconcileKaraoke(next,moved).cues.some(c=>c.anchor.kind==='word')).toBe(false);
 expect(()=>applyKaraoke(p.lyrics,p.karaoke,{kind:'groups',groups:[{id:'background',name:'B'}],moves:{},main:null,background:'background'})).toThrow('迁往');
});
it('rejects missing or overlapping source ranges instead of inventing gaps',()=>{
 const p=fixture(), line=p.lyrics.lines[0], anchor={kind:'word' as const,lineId:line.id,leftId:'a',rightId:'b'};
 line.words[0].beginMs=null;expect(anchorRange(p.lyrics,anchor)).toBeNull();
 line.words[0].beginMs=4000;line.words[1].beginMs=4900;expect(anchorRange(p.lyrics,anchor)).toBeNull();
});
it('limits all scans to selected groups and undoes thresholds together with cues',()=>{
 const p=fixture(), other=structuredClone(p.lyrics.lines[0]);other.id='other';other.words=other.words.map(w=>({...w,id:`other-${w.id}`,rubyUnits:w.rubyUnits.map(r=>({...r,id:`other-${r.id}`}))}));
 p.lyrics.lines.push(other);p.karaoke.lineGroups.other='background';
 const state=createProjectEditorState(p), next=executeProjectCommand(state,{type:'karaoke',command:{kind:'auto',groupIds:['background'],thresholds:{beforeMs:0,wordMs:0,rubyMs:0}}});
 expect(next.present.karaoke.cues).toHaveLength(3);expect(next.present.karaoke.cues.every(c=>c.anchor.lineId==='other')).toBe(true);
 expect(undoProjectCommand(next).present).toBe(p);
 expect(()=>applyKaraoke(p.lyrics,p.karaoke,{kind:'auto',groupIds:[],thresholds:p.karaoke.defaults})).toThrow('分组');
});
it('uses the latest prior occupied endpoint across overlapping and reordered lines',()=>{
 const p=fixture();p.lyrics.lines=[['a',0,20000],['b',5000,6000],['c',10000,11000]].map(([id,begin,end])=>{const line=createLine(String(id));Object.assign(line.words[0],{beginMs:begin,endMs:end});return line;});
 p.karaoke=reconcileKaraoke(p.lyrics,p.karaoke);
 expect(autoInsertCues(p.lyrics,p.karaoke).cues).toHaveLength(0);
 p.lyrics.lines.reverse();expect(autoInsertCues(p.lyrics,p.karaoke).cues).toHaveLength(0);
});
