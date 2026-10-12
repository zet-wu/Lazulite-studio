import { expect, it } from 'vitest';
import { createLine, createLyricDocument } from '../src/domain/lyric-document';
import { createProjectDocument, createProjectEditorState, executeProjectCommand, undoProjectCommand } from '../src/domain/project-document';
import { applyKaraoke, nextGroupId, groupIdProblem, outputId, reconcileKaraoke } from '../src/domain/karaoke';
import { parseProject, serializeProject } from '../src/adapters/project-codec';

it('renames definitions, members and all output kinds atomically, supports ID swaps',()=>{
 const p=createProjectDocument(createLyricDocument('歌'));const id=p.lyrics.lines[0].id;
 p.karaoke.outputs=[outputId('main'),outputId('main','translation','t'),outputId('background','romanization','r')];
 const state=createProjectEditorState(p),next=executeProjectCommand(state,{type:'karaoke',command:{kind:'groups',groups:[{id:'background',name:'原主'},{id:'main',name:'原背景'}],renames:{main:'background',background:'main'}}});
 expect(next.present.karaoke.lineGroups[id]).toBe('background');expect(next.present.karaoke.outputs).toEqual([outputId('background'),outputId('background','translation','t'),outputId('main','romanization','r')]);expect(undoProjectCommand(next).present).toBe(p);
});
it('deletes the last group, preserves explicit unassignment on reopen/recreation and adds future lines only',()=>{
 const p=createProjectDocument(createLyricDocument('歌')),id=p.lyrics.lines[0].id;
 p.karaoke=applyKaraoke(p.lyrics,p.karaoke,{kind:'groups',groups:[],renames:{}});
 expect(p.karaoke.lineGroups[id]).toBe('');expect(p.karaoke.outputs).toEqual([]);
 expect(parseProject(serializeProject(p))).toEqual(p);
 p.karaoke=applyKaraoke(p.lyrics,p.karaoke,{kind:'groups',groups:[{id:'main',name:'新主'}],renames:{}});
 p.lyrics.lines.push(createLine('新','new'));p.karaoke=reconcileKaraoke(p.lyrics,p.karaoke);
 expect(p.karaoke.lineGroups).toEqual({[id]:'',new:'main'});
});
it.each(['main','background','custom',''])('syncs identity changes only for a corresponding standard group: %s',group=>{
 const lyrics=createLyricDocument();lyrics.lines=[createLine('主','parent'),createLine('行','child')];
 const p=createProjectDocument(lyrics);p.karaoke.groups.push({id:'custom',name:'自定义'});p.karaoke.lineGroups.child=group;
 const state=createProjectEditorState(p), next=executeProjectCommand(state,{type:'lyrics',command:{type:'set-background-of',lineId:'child',parentLineId:'parent'}});
 expect(next.present.karaoke.lineGroups.child).toBe(group==='main'?'background':group);expect(undoProjectCommand(next).present).toBe(p);
 const back=executeProjectCommand(next,{type:'lyrics',command:{type:'set-background-of',lineId:'child',parentLineId:null}});
 expect(back.present.karaoke.lineGroups.child).toBe(['main','background'].includes(group)?'main':group);
 p.karaoke.groups=p.karaoke.groups.filter(g=>g.id!=='background');
 expect(executeProjectCommand(createProjectEditorState(p),{type:'lyrics',command:{type:'set-background-of',lineId:'child',parentLineId:'parent'}}).present.karaoke.lineGroups.child).toBe(group);
});
it('uses minimum readable number and validates edited IDs without rewriting legacy UUIDs',()=>{
 expect(nextGroupId([{id:'group1',name:'1'},{id:'GROUP3',name:'3'}])).toBe('group2');
 const old=[{id:'1234-uuid',name:'旧'}];expect(groupIdProblem(old,old,{'1234-uuid':'1234-uuid'})).toBeNull();
 expect(groupIdProblem(old,[{id:'1new',name:'新'}],{'1234-uuid':'1new'})).toContain('英文字母');
 expect(groupIdProblem([],[{id:'Main',name:'1'},{id:'main',name:'2'}],{})).toContain('重复');
});

it('copies explicit custom/unassigned group membership with each source line in one transaction',async()=>{
 const {copySelection,pasteRich}=await import('../src/features/editor/editing-actions');
 const lyrics=createLyricDocument();lyrics.lines=[createLine('主','a'),{...createLine('背景','b'),backgroundOf:'a'}];
 const p=createProjectDocument(lyrics);p.karaoke.groups.push({id:'custom',name:'自定义'});p.karaoke.lineGroups={a:'custom',b:''};
 const selection={kind:'lines' as const,ids:['a'],anchorId:'a',activeId:'a'};
 const clipboard=copySelection(lyrics,selection,p.editing,p.karaoke.lineGroups),paste=pasteRich(lyrics,clipboard,selection);
 const state=createProjectEditorState(p),next=executeProjectCommand(state,{type:'lyrics',command:paste.command});
 const copied=next.present.lyrics.lines.filter(line=>!['a','b'].includes(line.id));expect(copied).toHaveLength(2);
 expect(copied.map(line=>next.present.karaoke.lineGroups[line.id])).toEqual(['custom','']);expect(undoProjectCommand(next).present).toBe(p);
});
