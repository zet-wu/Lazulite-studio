import {expect,it} from 'vitest';
import {createLyricDocument} from '../src/domain/lyric-document';
import {importSugFile} from '../src/adapters/sug-import';
import {allocateSugTimes,type MeasureSugText,type SugCharacter} from '../src/adapters/sug-timing';
import {createProjectDocument,createProjectEditorState,executeProjectCommand,undoProjectCommand,redoProjectCommand} from '../src/domain/project-document';
import {serializeProject,parseProject} from '../src/adapters/project-codec';
const measure:MeasureSugText=text=>({advance:[...new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(text)].length,ink:/^\s*$/u.test(text)?0:1});
const char=(text:string,timestamps:number[]=[],extra:object={})=>({char:text,check_count:1,timestamps,...extra});
const row=(id:string,characters:object[],extra:object={})=>({id,characters,...extra});
const parse=(sentences:object[],extra:object={})=>importSugFile(JSON.stringify({version:'0.3.0',sentences,...extra}),measure);
it('treats ordinary checkpoints as starts, preserves releases and overlaps, and keeps guide text ordinary',()=>{
 const {document}=parse([row('a',[char('今',[1000,1500],{check_count:2,is_sentence_end:true,sentence_end_ts:2500,is_guide:true,needs_guide:true,ruby:{parts:[{text:'い'},{text:'ま'}]}})]),row('b',[char('歌',[2000],{is_sentence_end:true,sentence_end_ts:3000})])]);
 expect(document.lines.map(l=>[l.beginMs,l.endMs])).toEqual([[1000,2500],[2000,3000]]);
 expect(document.lines[0].words[0].rubyUnits.map(u=>[u.reading,u.beginMs,u.endMs])).toEqual([['い',1000,1500],['ま',1500,2500]]);
 expect(createProjectDocument(document).karaoke.cues).toEqual([]);
});
it('retains zero checkpoints and linked word groups, with whitespace taking no singing duration',()=>{
 const {document}=parse([row('a',[char('a',[1000],{linked_to_next:true}),char(' ',[],{check_count:0,linked_to_next:true}),char('b',[],{check_count:0,is_line_end:true})]),row('b',[char('次',[3000])])],{audio_duration_ms:5000});
 expect(document.lines[0].words).toHaveLength(1);expect(document.lines[0].words[0]).toMatchObject({text:'a b',beginMs:1000,endMs:3000});
 expect(document.lines[1].endMs).toBe(5000);
});
it('uses ink and ruby-part weights across multi-checkpoint leaders and following characters',()=>{
 const base: SugCharacter={text:'a',checkCount:2,timestamps:[1000,2000],release:null,stop:false,linked:false,singerId:'',parts:['i','mmm']};
 const measured:MeasureSugText=text=>({advance:text==='a'?2:text.length,ink:text==='a'?2:text.length});
 const times=allocateSugTimes([base,{...base,text:'b',checkCount:0,timestamps:[],parts:[]}],null,3000,measured);
 expect(times[0]).toMatchObject({beginMs:1000,endMs:2555,rubyEnd:3000});expect(times[1]).toMatchObject({beginMs:2555,endMs:3000});
});
it('keeps ruby pauses as gaps and preserves an incomplete enabled stop',()=>{
 const {document,incompleteCheckpoints}=parse([row('a',[char('歌',[1000,1500,2000],{check_count:3,is_sentence_end:true,sentence_end_ts:2500,ruby:{parts:[{text:'う'},{text:'^pause^'},{text:'た'}]}})]),row('b',[char('尾',[3000],{is_sentence_end:true})])],{audio_duration_ms:10000});
 expect(document.lines[0].words[0].rubyUnits.map(u=>[u.reading,u.beginMs,u.endMs])).toEqual([['う',1000,1500],['た',2000,2500]]);
 expect(document.lines[1].words[0]).toMatchObject({beginMs:3000,endMs:null});expect(incompleteCheckpoints).toBe(1);
});
it('stops successor lookup at unfinished singing and does not substitute media duration',()=>{
 const {document}=parse([row('a',[char('甲',[1000])]),row('missing',[char('乙')]),row('c',[char('丙',[5000])])],{audio_duration_ms:10000});
 expect(document.lines[0].endMs).toBeNull();expect(document.lines[1].beginMs).toBeNull();expect(document.lines[2].endMs).toBe(10000);
 const isolated=parse([row('a',[char('歌',[1000],{is_line_end:true})])]).document;expect(isolated.lines[0].endMs).toBeNull();
});
it('uses the corresponding lyric sequence and resolves forward auxiliary parent references',()=>{
 const {document}=parse([
  row('tr',[char('translation',[],{check_count:0})],{aux_role:'x-translation',aux_parent_id:'main',aux_lang:'en',aux_begin:1200,aux_end:2200}),
  row('bg',[char('声',[1400],{is_sentence_end:true,sentence_end_ts:2400})],{aux_role:'x-bg',aux_parent_id:'main'}),
  row('main',[char('歌',[1000])]),row('next',[char('次',[3000])]),
  row('roman',[char('uta',[1100],{is_sentence_end:true,sentence_end_ts:2000})],{aux_role:'x-roman',aux_parent_id:'main',aux_lang:'ja-Latn'})]);
 const main=document.lines.find(l=>!l.backgroundOf&&l.words[0].text==='歌')!;
 expect(main.endMs).toBe(3000);expect(document.lines[0].backgroundOf).toBe(main.id);
 expect(document.translationTracks[0].contents[0]).toMatchObject({lineId:main.id,kind:'timed',units:[{text:'translation',beginMs:1200,endMs:2200}]});
 expect(document.romanizationTracks[0].contents[0]).toMatchObject({lineId:main.id,kind:'timed',units:[{text:'uta',beginMs:1100,endMs:2000}]});
});
it('keeps independent singer IDs and full names, explicit types and references',()=>{
 const {document}=parse([row('a',[char('A',[1000],{singer_id:'source-2',is_sentence_end:true,sentence_end_ts:2000})],{singer_id:'source 1'})],{singers:[{id:'source 1',name:'A＋B',ttml_agent_type:'group'},{id:'source-2',name:'A＋B',type:'invalid',actorRef:'source 1'},{id:'empty',name:''}]});
 expect(document.agents).toEqual([{id:'v1',name:'A＋B',type:'group'},{id:'v2',name:'A＋B',type:'person',actorRef:'v1'},{id:'v3',name:null,type:'person'}]);
 expect(document.lines[0].agentRefs).toEqual(['v1']);expect(document.lines[0].words[0].agentRefs).toEqual(['v2']);
});
it('applies global offset once to body, ruby and auxiliary endpoints, clamping negative values to zero',()=>{
 const {document}=parse([row('a',[char('e\u0301',[100,500],{check_count:2,is_sentence_end:true,sentence_end_ts:1000,ruby:{parts:[{text:'e\u0301'},{text:'ŋ'}]}})]),row('tr',[char('译',[],{check_count:0})],{aux_role:'x-translation',aux_parent_id:'a',aux_begin:100,aux_end:1000})],{global_offset_ms:-200});
 expect(document.lines[0].words[0]).toMatchObject({text:'e\u0301',beginMs:0,endMs:800});expect(document.lines[0].words[0].rubyUnits.map(u=>[u.beginMs,u.endMs])).toEqual([[0,300],[300,800]]);
 expect(document.translationTracks[0].contents[0]).toMatchObject({units:[{beginMs:0,endMs:800}]});
});
it.each([{version:'2.0'}, {sentences:[row('x',[char('歌',[NaN])])]}, {singers:[{id:'x',name:'A'},{id:'x',name:'B'}]}, {sentences:[row('a',[char('歌',[1000],{singer_id:'missing'})])]}])('rejects damaged or unsupported source at the import boundary %j',extra=>{
 expect(()=>parse([row('a',[char('歌')])],extra)).toThrow();
});

it('imports lyrics and singers as one undo step, persists selected outputs and clears replaced cue references',()=>{
 const original=createProjectDocument(createLyricDocument('原'));
 const initial=createProjectEditorState(original);
 const {document}=parse([row('a',[char('歌',[1000],{is_sentence_end:true,sentence_end_ts:2000,singer_id:'s'})],{singer_id:'s'})],{singers:[{id:'s',name:'歌手'}]});
 const imported=executeProjectCommand(initial,{type:'lyrics',command:{type:'replace-document',document}});
 expect(imported.past).toHaveLength(1);expect(undoProjectCommand(imported).present).toBe(original);expect(redoProjectCommand(undoProjectCommand(imported)).present).toBe(imported.present);
 const restored=parseProject(serializeProject(imported.present));expect(restored.lyrics).toEqual(document);expect(restored.karaoke.lineGroups).toEqual(imported.present.karaoke.lineGroups);expect(restored.karaoke.cues).toEqual([]);
});
it('leaves fully untimed content unknown even with media duration, and rejects an unusable fallback boundary',()=>{
 expect(parse([row('a',[char('未')])],{audio_duration_ms:10000}).document.lines[0].words[0]).toMatchObject({beginMs:null,endMs:null});
 expect(parse([row('a',[char('歌',[1500])])],{audio_duration_ms:1000}).document.lines[0].words[0]).toMatchObject({beginMs:1500,endMs:null});
});
it('round-trips an upstream-saved external file with forward background order and missing release',async()=>{
 const {readFileSync}=await import('node:fs');const {createProjectEditing}=await import('../src/domain/project-editing');const {displayLines}=await import('../src/domain/amll-compatibility');
 const {document,incompleteCheckpoints}=importSugFile(readFileSync('tests/fixtures/external-current.sug','utf8'),measure);
 const original=createProjectDocument();original.amll.noIndependentBackground=false;original.amll.noWordAgents=false;
 const state=executeProjectCommand(createProjectEditorState(original),{type:'lyrics',command:{type:'replace-document',document,editing:createProjectEditing()}});
 const project=state.present;const translation=project.lyrics.translationTracks[0];project.karaoke.outputs=[JSON.stringify(['main','translation',translation.id])];project.karaoke.offsets[project.karaoke.outputs[0]]=120;
 const snapshot=serializeProject(project),reopened=parseProject(snapshot);
 expect(incompleteCheckpoints).toBe(1);expect(displayLines(reopened.lyrics,reopened.lineOrder).map(l=>l.words.map(w=>w.text).join(''))).toEqual(['声','今は','é']);
 expect(reopened.lyrics.lines.find(l=>l.words[0]?.text==='é')!.endMs).toBeNull();expect(reopened.lyrics.agents.map(a=>a.name)).toEqual(['完整名称 A＋B','完整名称 A＋B']);
 expect(reopened.karaoke.outputs).toEqual(project.karaoke.outputs);
});
it('retains an explicit resolvable self actor reference',()=>{
 const {document}=parse([row('a',[char('歌')])],{singers:[{id:'self',name:'角色',actorRef:'self'}]});expect(document.agents[0].actorRef).toBe('v1');
});
