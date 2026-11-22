import { expect, it } from 'vitest';
import { createLyricDocument, createWord } from '../src/domain/lyric-document';
import { createProjectDocument, createProjectEditorState, executeProjectCommand, undoProjectCommand, redoProjectCommand } from '../src/domain/project-document';
import { applyKaraoke, outputId, reconcileKaraoke, autoInsertCues } from '../src/domain/karaoke';
import { parseProject, serializeProject } from '../src/adapters/project-codec';
import { sugSingerOptions, sugSingerName } from '../src/adapters/sug-singers';
import { parseLyricTtml } from '../src/adapters/ttml/lyric-codec';
import { prepareSug } from '../src/adapters/sug';
function fixture() {
  const p=createProjectDocument(createLyricDocument('歌'));
  p.amll.noWordAgents=false;
  p.lyrics.agents=[{id:'a',name:'A',type:'person'},{id:'b',name:'B',type:'person'}];
  const line=p.lyrics.lines[0];line.agentRefs=['b'];
  line.words=[{...createWord('歌'),beginMs:4000,endMs:5000,agentRefs:['a']}];
  p.lyrics.translationTracks=[{id:'t',language:'zh-CN',purpose:'subtitle',contents:[{id:'c',lineId:line.id,kind:'plain',text:'歌'}]}];
  return p;
}
it('collects body word and auxiliary line singers independently of selection or missing times',()=>{
  const p=fixture();p.karaoke.outputs=[];p.lyrics.lines[0].words[0].beginMs=null;
  const options=sugSingerOptions(p);expect(options.map(o=>[o.output.kind,o.sets.map(s=>s.ids)])).toEqual([['body',[['b'],['a']]],['translation',[['b']]]]);
  p.karaoke.outputs=[outputId('main')];expect(sugSingerOptions(p)).toEqual(options);
  p.lyrics.translationTracks[0].contents=[];expect(sugSingerOptions(p)).toHaveLength(1);
});
it('resolves defaults from whole chorus, group ID and exact language; overrides stay independent',()=>{
  const p=fixture(),line=p.lyrics.lines[0];line.words[0].agentRefs=['b','a'];line.agentRefs=['a','b'];
  p.karaoke.lineGroups[line.id]='background';
  let options=sugSingerOptions(p);expect(options.map(o=>sugSingerName(p,o.output,o.sets[0]))).toEqual(['A+B.background','A+B.background.zh-CN']);
  const name={outputId:options[0].output.id,agentIds:['b','a'],name:'共同'};p.karaoke.sugSingerNames=[name];
  p.lyrics.agents[0].name='改名';p.lyrics.translationTracks[0].language=null;options=sugSingerOptions(p);
  expect(options.map(o=>sugSingerName(p,o.output,o.sets[0]))).toEqual(['共同','改名+B.background.und']);
  p.karaoke.sugSingerNames=[];expect(sugSingerName(p,options[0].output,options[0].sets[0])).toBe('改名+B.background');
});
it('merges solos, chorus, unspecified and guides by exact final name and can split them again',()=>{
  const p=fixture(),line=p.lyrics.lines[0];line.agentRefs=[];
  line.words=[['a'],['b'],['b','a'],[]].map((agentRefs,i)=>({...createWord('歌'),agentRefs,beginMs:4000+i*2000,endMs:5000+i*2000}));
  p.karaoke=autoInsertCues(p.lyrics,p.karaoke);
  p.karaoke.sugSingerNames=[['a'],['b'],['a','b'],[]].map(agentIds=>({outputId:outputId('main'),agentIds,name:'共同'}));
  let result=prepareSug(p,'曲');expect(result.issues).toEqual([]);
  let data=JSON.parse(result.files[0].text);expect(data.singers).toHaveLength(1);expect(data.singers[0]).toMatchObject({name:'共同',is_default:true});
  expect(data.sentences.flatMap((s:any)=>[s.singer_id,...s.characters.map((c:any)=>c.singer_id)]).every((id:string)=>id===data.singers[0].id)).toBe(true);
  p.karaoke.sugSingerNames[1].name='B';data=JSON.parse(prepareSug(p,'曲').files[0].text);expect(data.singers.map((s:any)=>s.name)).toEqual(['共同','B']);
  p.karaoke.outputs.push(outputId('main','translation','t'));data=JSON.parse(prepareSug(p,'曲').files[1].text);expect(data.singers[0].name).toBe('未指定.zh-CN');
});
it('merges identical default names without normalizing case or Unicode',()=>{
  const p=fixture(),line=p.lyrics.lines[0];p.lyrics.agents[1].name='A';line.words.push({...createWord('次'),agentRefs:['b'],beginMs:6000,endMs:7000});
  let data=JSON.parse(prepareSug(p,'曲').files[0].text);expect(data.singers.filter((s:any)=>!s.is_default)).toHaveLength(1);
  p.karaoke.sugSingerNames=[{outputId:outputId('main'),agentIds:['b'],name:'a'}];data=JSON.parse(prepareSug(p,'曲').files[0].text);expect(data.singers.map((s:any)=>s.name)).toEqual(['未指定','A','a']);
});
it('commits atomically, undoes, redoes and roundtrips optional overrides',()=>{
  const p=fixture(),names=[{outputId:outputId('main'),agentIds:['a'],name:'自定义'}];
  const state=executeProjectCommand(createProjectEditorState(p),{type:'karaoke',command:{kind:'sug-singer-names',names}});
  expect(undoProjectCommand(state).present.karaoke.sugSingerNames).toBeUndefined();expect(redoProjectCommand(undoProjectCommand(state)).present).toEqual(state.present);
  expect(parseProject(serializeProject(state.present)).karaoke.sugSingerNames).toEqual(names);
  expect(parseProject(serializeProject(p)).karaoke.sugSingerNames).toBeUndefined();
  expect(()=>applyKaraoke(p.lyrics,p.karaoke,{kind:'sug-singer-names',names:[...names,...names]})).toThrow();
});
it('moves renamed groups, retains deselected and temporarily empty content, removes deleted identities',()=>{
  const p=fixture();p.karaoke.sugSingerNames=[{outputId:outputId('main'),agentIds:['a'],name:'A!'},{outputId:outputId('main','translation','t'),agentIds:['b'],name:'B!'}];
  p.karaoke=applyKaraoke(p.lyrics,p.karaoke,{kind:'groups',groups:[{id:'lead',name:'主'}],renames:{main:'lead'}});
  expect(p.karaoke.sugSingerNames!.map(n=>JSON.parse(n.outputId)[0])).toEqual(['lead','lead']);
  p.karaoke.outputs=[];p.lyrics.lines[0].words=[];p.lyrics.translationTracks[0].contents=[];
  p.karaoke=reconcileKaraoke(p.lyrics,p.karaoke);expect(p.karaoke.sugSingerNames).toHaveLength(2);
  p.lyrics.translationTracks=[];p.karaoke=reconcileKaraoke(p.lyrics,p.karaoke);expect(p.karaoke.sugSingerNames).toHaveLength(1);
  p.lyrics.agents=[];p.karaoke=reconcileKaraoke(p.lyrics,p.karaoke);expect(p.karaoke.sugSingerNames).toEqual([]);
});

it('keeps same-language tracks independent and uses custom group IDs for romanization defaults',()=>{
  const p=fixture(),line=p.lyrics.lines[0];p.karaoke.groups.push({id:'custom',name:'展示名'});p.karaoke.lineGroups[line.id]='custom';
  p.lyrics.romanizationTracks=['r1','r2'].map(id=>({id,language:'ja-Latn',purpose:'subtitle',contents:[{id:`c-${id}`,lineId:line.id,kind:'plain' as const,text:'uta'}]}));
  const options=sugSingerOptions(p).filter(o=>o.output.kind==='romanization');
  expect(options.map(o=>sugSingerName(p,o.output,o.sets[0]))).toEqual(['B.custom.ja-Latn','B.custom.ja-Latn']);
  p.karaoke.sugSingerNames=[{outputId:options[0].output.id,agentIds:['b'],name:'共用'}];
  expect(options.map(o=>sugSingerName(p,o.output,o.sets[0]))).toEqual(['共用','B.custom.ja-Latn']);
});

it('preserves independent background sentence singers, word overrides and auxiliary roles through project roundtrip',()=>{
  const lyrics=parseLyricTtml('<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata"><head><metadata><ttm:agent xml:id="a" type="person"><ttm:name>A</ttm:name></ttm:agent><ttm:agent xml:id="b" type="person"><ttm:name>B</ttm:name></ttm:agent></metadata></head><body><p xml:id="lead" ttm:agent="a" begin="4" end="8"><span begin="4" end="5">主</span><span ttm:role="x-bg" ttm:agent="b" begin="6" end="8"><span begin="6" end="7">背</span><span begin="7" end="8" ttm:agent="a">景</span><span ttm:role="x-translation" xml:lang="en">backing</span></span></p></body></tt>');
  let p=createProjectDocument(lyrics);p.amll.noWordAgents=false;
  p=parseProject(serializeProject(p));
  const bg=p.lyrics.lines.find(line=>line.backgroundOf)!;
  const body=outputId('background'),translation=outputId('background','translation',p.lyrics.translationTracks[0].id);
  p.karaoke.outputs=[outputId('main'),body,translation];
  p.karaoke.sugSingerNames=[{outputId:body,agentIds:['b'],name:'背景独唱'}];
  p.karaoke=autoInsertCues(p.lyrics,p.karaoke);
  const result=prepareSug(p,'background');expect(result.issues).toEqual([]);
  const files=result.files.map(file=>JSON.parse(file.text));
  const role=(file:any,id:string)=>file.singers.find((s:any)=>s.id===id).name;
  expect(files.map(file=>role(file,file.sentences[0].singer_id))).toEqual(['A','背景独唱','B.background.en']);
  const background=files[1],characters=background.sentences[0].characters;
  expect(characters.filter((c:any)=>!c.is_guide).map((c:any)=>role(background,c.singer_id))).toEqual(['背景独唱','A.background']);
  expect(characters.filter((c:any)=>c.is_guide).map((c:any)=>role(background,c.singer_id))).toEqual(['背景独唱']);
  // Even when every word overrides the line, its own exported role remains configurable.
  bg.words.forEach(word=>word.agentRefs=['a']);
  expect(sugSingerOptions(p).find(item=>item.output.id===body)!.sets.map(set=>set.ids)).toContainEqual(['b']);
  bg.agentRefs=[];
  const inherited=JSON.parse(prepareSug(p,'background').files.find(file=>file.output.id===body)!.text);
  expect(role(inherited,inherited.sentences[0].singer_id)).toBe('A.background');
});
