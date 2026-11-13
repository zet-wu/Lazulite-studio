import { expect, it } from 'vitest';
import { createLyricDocument } from '../src/domain/lyric-document';
import { createLyricEditorState, executeLyricCommand, undoLyricCommand } from './helpers/project-history';
import { parseLyricTtml, serializeLyricTtml } from '../src/adapters/ttml/lyric-codec';
import { collectOutputIssues } from '../src/adapters/output-validation';
const source = `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata"><head><metadata><ttm:agent xml:id="role" type="character"><ttm:name>角色</ttm:name><ttm:actor agent="actor"/></ttm:agent><ttm:agent xml:id="actor" type="person"/></metadata></head><body><div><p begin="00:01.000" end="00:02.000" ttm:agent="role actor">歌</p></div></body></tt>`;
it('preserves forward actor references, order, draft and final output; renames/deletes both references atomically', () => {
 const doc = parseLyricTtml(source);
 for (const draft of [true, false]) expect(parseLyricTtml(serializeLyricTtml(doc,{draft})).agents).toEqual(doc.agents);
 doc.lines[0].words[0].agentRefs=['actor'];
 const state = createLyricEditorState(doc);
 state.project.present.amll.noWordAgents=false;
 const renamed = executeLyricCommand(state,{type:'rename-agent',id:'actor',nextId:'performer'});
 expect(renamed.present.agents[0].actorRef).toBe('performer');
 expect(renamed.present.lines[0].words[0].agentRefs).toEqual(['performer']);
 expect(renamed.present.lines[0].agentRefs).toEqual(['role','performer']);
 expect(undoLyricCommand(renamed).present).toBe(doc);
 const deleted = executeLyricCommand(renamed,{type:'delete-agent',id:'performer'});
 expect(deleted.present.agents).toEqual([{id:'role',name:'角色',type:'character'}]);
 expect(deleted.present.lines[0].agentRefs).toEqual(['role']);
 expect(deleted.present.lines[0].words[0].agentRefs).toBeUndefined();
 expect(undoLyricCommand(deleted).present).toBe(renamed.present);
 expect(()=>executeLyricCommand(state,{type:'rename-agent',id:'actor',nextId:'role'})).toThrow();
 expect(()=>executeLyricCommand(state,{type:'set-agents',agents:[doc.agents[0]]})).toThrow();
});
it('reports unsupported actor/name structures and dangling references explicitly', () => {
 for (const [actor,code] of [['<ttm:actor agent="missing"/>','ttml.actorMissing'],['<ttm:actor agent="actor" extra="x"/>','ttml.agentAttribute'],['<ttm:actor agent="actor"><ttm:name>x</ttm:name></ttm:actor>','ttml.agentActor'],['<ttm:actor agent="actor"/><ttm:actor agent="actor"/>','ttml.agentStructure']]) expect(()=>parseLyricTtml(source.replace('<ttm:actor agent="actor"/>',actor))).toThrow(code);
 expect(()=>parseLyricTtml(source.replace('<ttm:name>角色</ttm:name>','<ttm:name type="full">角色</ttm:name>'))).toThrow('ttml.agentAttribute');
});
it('keeps invalid types in drafts and gates only TTML outputs', () => {
 const doc = parseLyricTtml(source.replace('type="person"','type="invalid"'));
 expect(parseLyricTtml(serializeLyricTtml(doc,{draft:true})).agents[1].type).toBe('invalid');
 expect(collectOutputIssues(doc,'ttml')).toEqual([expect.objectContaining({kind:'agent',agentId:'actor'})]);
 expect(collectOutputIssues(doc,'lrc')).toEqual([]);
 expect(collectOutputIssues(doc,'txt')).toEqual([]);
});
it('renames metadata without changing values or order and rejects collisions', () => {
 const doc=createLyricDocument();doc.metadata={title:[' one ','two\nthree'],artist:['a']};
 const state=createLyricEditorState(doc), next=executeLyricCommand(state,{type:'rename-metadata',key:'title',nextKey:'custom'});
 expect(next.present.metadata).toEqual({custom:[' one ','two\nthree'],artist:['a']});
 expect(undoLyricCommand(next).present).toBe(doc);
 expect(()=>executeLyricCommand(state,{type:'rename-metadata',key:'title',nextKey:'artist'})).toThrow();
});
it('declaration order changes preview baseline only for directly referenced main-line singers', async () => {
 const { toAmllLines } = await import('../src/domain/preview-adapter');
 const doc=parseLyricTtml(source);
 doc.lines[0].agentRefs=['role'];
 const original=toAmllLines(doc,true,true);
 const moved={...doc,agents:[doc.agents[1],doc.agents[0]]};
 expect(toAmllLines(moved,true,true)).toEqual(original);
});
it('stores direct cyclic actor references for every type and preserves imported self references',()=>{
 const doc=parseLyricTtml(source);
 const state=createLyricEditorState(doc);
 const next=executeLyricCommand(state,{type:'set-agents',agents:doc.agents.map(a=>({...a,actorRef:a.id==='role'?'actor':'role'}))});
 for(const draft of [true,false]) expect(parseLyricTtml(serializeLyricTtml(next.present,{draft})).agents).toEqual(next.present.agents);
 expect(undoLyricCommand(next).present).toBe(doc);
 const self=parseLyricTtml(source.replace('agent="actor"/>','agent="role"/>'));
 expect(parseLyricTtml(serializeLyricTtml(self)).agents).toEqual(self.agents);
});
