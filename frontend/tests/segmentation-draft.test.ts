import { expect, it } from 'vitest';
import { createLyricDocument } from '../src/domain/lyric-document';
import { moveSegmentRuby, splitRubyWord, toggleSegmentBoundary } from '../src/domain/segmentation-draft';
import { createLyricEditorState, executeLyricCommand, undoLyricCommand, redoLyricCommand } from './helpers/project-history';
function fixture() {
 const document = createLyricDocument('甲乙丙丁'), source = document.lines[0].words[0];
 source.beginMs = 0; source.endMs = 1000;
 source.rubyUnits = ['a','b','c','d'].map((reading,index)=>({id:reading,reading,beginMs:100+index*100,endMs:200+index*100}));
 return {document,source};
}
it('proportionally partitions whole units and uses ruby envelopes instead of source endpoints',()=>{
 const {source}=fixture();const words=splitRubyWord(source,['甲','乙丙丁']);
 expect(words.map(w=>w.rubyUnits.map(r=>r.id))).toEqual([['a'],['b','c','d']]);
 expect(words.map(w=>[w.beginMs,w.endMs])).toEqual([[100,200],[200,500]]);
 expect(words.flatMap(w=>w.rubyUnits)).toEqual(source.rubyUnits);
});
it('rejects reordered and foreign units, supports legal multiselection without moving other units',()=>{
 const {source}=fixture(), words=splitRubyWord(source,['甲乙','丙丁']);
 expect(moveSegmentRuby(words,['a'],1)).toBeNull();expect(moveSegmentRuby(words,['foreign'],1)).toBeNull();
 expect(moveSegmentRuby(words,['b','c'],1)?.map(w=>w.rubyUnits.map(r=>r.id))).toEqual([['a'],['b','c','d']]);
 const moved=moveSegmentRuby(words,['a','b'],1)!;
 expect(moved[0]).toMatchObject({rubyUnits:[],beginMs:null,endMs:null});
 expect(moveSegmentRuby(moved,['a'],0)![0]).toMatchObject({beginMs:100,endMs:200});
});
it('preserves adjusted neighboring ownership on boundary edits and restores original on final merge',()=>{
 const {source}=fixture();let words=moveSegmentRuby(splitRubyWord(source,['甲乙','丙丁']),['b'],1)!;
 words=toggleSegmentBoundary(source,words,3);expect(words.map(w=>w.rubyUnits.map(r=>r.id))).toEqual([['a'],['b','c'],['d']]);
 words=toggleSegmentBoundary(source,words,3);words=toggleSegmentBoundary(source,words,2);expect(words).toEqual([source]);
});
it('keeps empty ruby children untimed on further subdivision and handles partial timing independently',()=>{
 const {source}=fixture();source.rubyUnits=source.rubyUnits.slice(0,1);source.rubyUnits[0].beginMs=null;
 let words=splitRubyWord(source,['甲乙','丙丁']);words=moveSegmentRuby(words,['a'],1)!;
 words=toggleSegmentBoundary(source,words,1);expect(words.slice(0,2).map(w=>[w.beginMs,w.endMs])).toEqual([[null,null],[null,null]]);
 expect(words[2]).toMatchObject({beginMs:null,endMs:200});
 source.rubyUnits[0].endMs=null;expect(splitRubyWord(source,['甲','乙','丙','丁']).every(w=>w.beginMs===null&&w.endMs===null)).toBe(true);
});
it.each(['segment-word','segment-words'] as const)('validates and atomically undoes/redoes %s ruby structure',type=>{
 const {document,source}=fixture(),words=splitRubyWord(source,['甲乙','丙丁']);
 const command=type==='segment-word'?{type,lineId:document.lines[0].id,wordId:source.id,words}:{type,changes:[{lineId:document.lines[0].id,wordId:source.id,words}]};
 const state=executeLyricCommand(createLyricEditorState(document),command);
 expect(state.present.lines[0].words).toEqual(words);expect(undoLyricCommand(state).present).toEqual(document);expect(redoLyricCommand(undoLyricCommand(state)).present).toEqual(state.present);
 words[0].rubyUnits.reverse();expect(()=>executeLyricCommand(createLyricEditorState(document),command)).toThrow('command.segmentNewAttributes');
});

it.each(['missing','changed','time'] as const)('rejects %s ruby submission without altering original',variant=>{
 const {document,source}=fixture(), words=splitRubyWord(source,['甲乙','丙丁']);
 if(variant==='missing') words[0].rubyUnits=words[0].rubyUnits.slice(1);
 if(variant==='changed') words[0].rubyUnits=[{...words[0].rubyUnits[0],reading:'changed'},words[0].rubyUnits[1]];
 if(variant==='time') words[0].beginMs=source.beginMs;
 const state=createLyricEditorState(document);
 expect(()=>executeLyricCommand(state,{type:'segment-words',changes:[{lineId:document.lines[0].id,wordId:source.id,words}]})).toThrow();
 expect(state.present).toBe(document);expect(source.rubyUnits.map(r=>r.reading)).toEqual(['a','b','c','d']);
});
it('submission rejects a split within a combining grapheme',()=>{
 const document=createLyricDocument('éx'), source=document.lines[0].words[0];
 expect(()=>executeLyricCommand(createLyricEditorState(document),{type:'segment-word',lineId:document.lines[0].id,wordId:source.id,words:[{...source,text:'e'},{...source,id:'new',text:'́x'}]})).toThrow('command.segmentText');
});

it('retains ruby beat attributes and singer references through project save and reopen',async()=>{
 const {parseProject,serializeProject}=await import('../src/adapters/project-codec');
 const {document,source}=fixture();
 document.agents=[{id:'v1',type:'person',name:'Singer'}];source.agentRefs=['v1'];
 let state=createLyricEditorState(document);
 state.project.present.amll.noWordAgents=false;state.project.present.amll.simplified=false;
 state=executeLyricCommand(state,{type:'set-empty-beat',id:'b',kind:'ruby',count:2});
 const words=moveSegmentRuby(splitRubyWord(source,['甲乙','丙丁']),['b'],1)!;
 state=executeLyricCommand(state,{type:'segment-words',changes:[{lineId:document.lines[0].id,wordId:source.id,words}]});
 const saved=parseProject(serializeProject(state.project.present));
 expect(saved.lyrics.lines[0].words).toEqual(words);
 expect(saved.lyrics.lines[0].words.every(word=>word.agentRefs?.join()==='v1')).toBe(true);
 expect(saved.editing.emptyBeats.b).toEqual({kind:'ruby',count:2});
});
