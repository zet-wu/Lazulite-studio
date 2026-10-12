import { cueProblem, createKaraoke, reconcileKaraoke, applyKaraoke, type Karaoke, type KaraokeCommand } from './karaoke';
import { assertAmll, checkAmll, createAmllSettings, amllDependencies, displayLines, groupDisplayLines, lineAgents, type AmllRule, type AmllSettings } from './amll-compatibility';
import { createProjectEditing, type ProjectEditing } from './project-editing';
import { applyLyricTransaction, type LyricCommand } from './lyric-commands';
import { createLyricDocument, type LyricDocument } from './lyric-document';

export type VocalSegment = { id: string; beginMs: number; endMs: number };
export type Acoustics = { analysisId: string | null; segments: VocalSegment[] };
export type ProjectDocument = {
  schemaVersion: 'studio-project-v8';
  lyrics: LyricDocument;
  karaoke: Karaoke;
  amll: AmllSettings;
  lineOrder: string[];
  acoustics: Acoustics;
  editing: ProjectEditing;
};
export type ProjectSnapshot = Omit<ProjectDocument, 'lyrics'> & { lyrics: { draftTtml: string } };
export type ProjectEditorState = { present: ProjectDocument; past: ProjectDocument[]; future: ProjectDocument[] };
export type ProjectCommand = { type: 'karaoke'; command: KaraokeCommand } | { type: 'alignment'; source: ProjectDocument; project: ProjectDocument } | { type: 'amll-setting'; rule: AmllRule; enabled: boolean } | { type: 'background-position'; lineId: string; before: boolean } | { type: 'amll-batch'; rule: AmllRule; ids?: string[]; duetAgents?: string[] } | { type: 'duet'; lineId: string; duet: boolean } | { type: 'lyrics'; command: LyricCommand } | { type: 'acoustics'; acoustics: Acoustics; durationMs: number };
export function createProjectDocument(lyrics = createLyricDocument()): ProjectDocument {
  return { schemaVersion: 'studio-project-v8', lyrics, karaoke: createKaraoke(lyrics), amll: createAmllSettings(), lineOrder: [], editing: createProjectEditing(), acoustics: { analysisId: null, segments: [] } };
}
export function validateSegments(segments: VocalSegment[], durationMs: number) {
  const ids = new Set<string>();
  for (const segment of segments) {
    if (!segment.id || ids.has(segment.id) || !Number.isSafeInteger(segment.beginMs) || !Number.isSafeInteger(segment.endMs) || segment.beginMs < 0 || segment.beginMs >= segment.endMs || segment.endMs > durationMs) throw new Error('人声片段必须具有唯一标识，且位于歌曲范围内');
    ids.add(segment.id);
  }
}
export function createProjectEditorState(present: ProjectDocument): ProjectEditorState { return { present, past: [], future: [] }; }
export function executeProjectCommand(state: ProjectEditorState, command: ProjectCommand): ProjectEditorState {
  let present: ProjectDocument;
  if (command.type === 'karaoke') {
    const karaoke = applyKaraoke(state.present.lyrics, state.present.karaoke, command.command);
    if (karaoke === state.present.karaoke) return state;
    present = { ...state.present, karaoke };
  } else if (command.type === 'alignment') {
    if (command.source !== state.present) throw new Error('项目已改变，请重新运行自动对齐');
    if (command.project === state.present) return state;
    present = command.project;
  } else if (command.type === 'amll-setting') {
    const amll = {...state.present.amll};
    if (amll.simplified && amllDependencies.includes(command.rule)) throw new Error('简化模型已锁定此限制');
    amll[command.rule] = command.enabled;
    if (amll.simplified) for (const key of amllDependencies) amll[key] = true;
    if (JSON.stringify(amll) === JSON.stringify(state.present.amll)) return state;
    present = {...state.present, amll};
  } else if (command.type === 'background-position') {
    if (!state.present.lyrics.lines.find(line=>line.id===command.lineId)?.backgroundOf) throw new Error('只能前置背景行');
    const line = state.present.lyrics.lines.find(line=>line.id===command.lineId)!;
    const shown=displayLines(state.present.lyrics,state.present.lineOrder);
    if((shown.indexOf(line)<shown.findIndex(item=>item.id===line.backgroundOf))===command.before)return state;
    const ids=shown.map(item=>item.id).filter(id=>id!==line.id);
    const parent=ids.indexOf(line.backgroundOf!);
    const end=ids.reduce((last,id,i)=>state.present.lyrics.lines.find(item=>item.id===id)?.backgroundOf===line.backgroundOf ? Math.max(last,i):last,parent);
    ids.splice((command.before?parent:end+1),0,line.id);
    if(ids.join(' ')==shown.map(item=>item.id).join(' '))return state;
    present = {...state.present,lineOrder:ids};
  } else if (command.type === 'amll-batch' || command.type === 'duet') {
    const lyrics = structuredClone(state.present.lyrics);
    if(command.type==='duet') {
      if(!state.present.amll.simplified) throw new Error('请先启用简化歌手模型');
      const line=lyrics.lines.find(line=>line.id===command.lineId);
      if(!line || line.backgroundOf) throw new Error('请选择主行');
      const id=command.duet?'v2':'v1';
      if(!lyrics.agents.some(agent=>agent.id===id)) lyrics.agents.push({id,name:null,type:'person'});
      line.agentRefs=[id];
      for(const bg of lyrics.lines.filter(bg=>bg.backgroundOf===line.id)) bg.agentRefs=[];
    } else {
      const ids=command.ids?.length?command.ids:checkAmll(lyrics)[command.rule].map(issue=>issue.id);
      const included=(id:string)=>ids.includes(id);
      if(command.rule==='simplified') {
        for(const line of lyrics.lines) {
          line.agentRefs=line.backgroundOf?[]:[command.duetAgents?.includes(line.agentRefs[0])?'v2':'v1'];
          for(const word of line.words) delete word.agentRefs;
        }
        lyrics.agents=[{id:'v1',name:null,type:'person'},{id:'v2',name:null,type:'person'}];
      } else if(command.rule==='noMultipleBackgrounds') {
        const displayed=displayLines(lyrics,state.present.lineOrder);
        let converted=false;
        for(const parent of lyrics.lines.filter(line=>!line.backgroundOf&&included(line.id))) {
          for(const bg of lyrics.lines.filter(line=>line.backgroundOf===parent.id).slice(1)) {
            bg.agentRefs=[...lineAgents(lyrics,bg)]; bg.backgroundOf=null; converted=true;
          }
        }
        if(converted) lyrics.lines=displayed;
      } else for(const line of lyrics.lines) {
        if(command.rule==='noChorus') {
          if(included(line.id)) line.agentRefs=line.agentRefs.slice(0,1);
          for(const word of line.words) if(included(word.id)&&word.agentRefs) word.agentRefs=word.agentRefs.slice(0,1);
        }
        if(command.rule==='noWordAgents') for(const word of line.words) if(included(word.id)) delete word.agentRefs;
        if(command.rule==='noIndependentBackground'&&line.backgroundOf&&included(line.id)) {line.agentRefs=[];for(const word of line.words) delete word.agentRefs;}
      }
    }
    if(JSON.stringify(lyrics)===JSON.stringify(state.present.lyrics)) return state;
    const result=applyLyricTransaction(state.present.lyrics,{type:'replace-document',document:lyrics},state.present.editing);
    present={...state.present,...result, lineOrder:command.type==='amll-batch'&&command.rule==='noMultipleBackgrounds'?lyrics.lines.map(line=>line.id):state.present.lineOrder};
  } else if (command.type === 'lyrics') {
    const result = applyLyricTransaction(state.present.lyrics, command.command, state.present.editing);
    if (result.lyrics === state.present.lyrics && result.editing === state.present.editing) return state;
    let karaoke = state.present.karaoke;
    const commands = command.command.type === 'batch' ? command.command.commands : [command.command];
    const moved = new Set<string>();
    for (const item of commands) if (item.type === 'merge-lines') {
      const selected = state.present.lyrics.lines.filter(line => item.lineIds.includes(line.id));
      const group = selected.map(line => karaoke.lineGroups[line.id]).find(id => id && karaoke.groups.some(group => group.id === id)) ?? '';
      karaoke = { ...karaoke, lineGroups: { ...karaoke.lineGroups, [selected[0].id]: group } };
    }
    for (const item of commands) if (item.type === 'shift-lines') {
      karaoke = { ...karaoke, cues: karaoke.cues.map(cue => {
        if (!item.lineIds.includes(cue.anchor.lineId)) return cue;
        moved.add(cue.id);
        return { ...cue, beginMs: cue.beginMs + item.deltaMs, endMs: cue.endMs + item.deltaMs };
      }) };
    }
    for (const cue of karaoke.cues) if (moved.has(cue.id)) {
      const problem = cueProblem(result.lyrics, karaoke, cue);
      if (problem) throw new Error(`行 ${cue.anchor.lineId} · 导唱 ${cue.id}：${problem}`);
    }
    const previous=displayLines(state.present.lyrics,state.present.lineOrder);
    const before=previous.filter((line,i)=>line.backgroundOf&&i<previous.findIndex(item=>item.id===line.backgroundOf)).map(line=>line.id);
    const changedOrder=result.lyrics.lines.map(line=>line.id).join(' ')!==state.present.lyrics.lines.map(line=>line.id).join(' ');
    present = { ...state.present, ...result, karaoke, lineOrder:changedOrder?groupDisplayLines(result.lyrics,before).map(line=>line.id):state.present.lineOrder };
  } else {
    validateSegments(command.acoustics.segments, command.durationMs);
    if (command.acoustics === state.present.acoustics) return state;
    present = { ...state.present, acoustics: command.acoustics };
  }
  if (present.lyrics !== state.present.lyrics) present = { ...present, karaoke: reconcileKaraoke(present.lyrics, present.karaoke) };
  const lineIds=new Set(present.lyrics.lines.map(line=>line.id));
  present = { ...present, lineOrder: present.lineOrder.filter(id=>lineIds.has(id)) };
  assertAmll(present.lyrics, present.amll);
  return { present, past: [...state.past.slice(-255), state.present], future: [] };
}
export function undoProjectCommand(state: ProjectEditorState): ProjectEditorState {
  return !state.past.length ? state : { present: state.past.at(-1)!, past: state.past.slice(0, -1), future: [state.present, ...state.future] };
}
export function redoProjectCommand(state: ProjectEditorState): ProjectEditorState {
  return !state.future.length ? state : { present: state.future[0], past: [...state.past, state.present], future: state.future.slice(1) };
}
