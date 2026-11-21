import { errorMessage, message } from '../domain/messages';
import { createLine, createWord, type LyricDocument, type LyricLine } from '../domain/lyric-document';
import type { ProjectDocument } from '../domain/project-document';
import { createKaraoke, outputId } from '../domain/karaoke';
import { exportFormats, exportLyricFile, type ExportFormat } from './lyric-formats';
import { prepareAss, renderAss } from './ass';
import { karaokeOutputs, safeFilename } from './karaoke-output';
import { prepareNicokara, nicokaraArchiveFiles } from './nicokara';
import { prepareSug } from './sug';
import { DocumentOutputError, type OutputIssue } from './output-validation';

export const downloadFormats = [...exportFormats, ['nicokara','NicoKara'], ['sug','SUG']] as const;
export type DownloadFormat = ExportFormat | 'nicokara' | 'sug';
export type OutputProject = Pick<ProjectDocument,'lyrics'|'karaoke'|'editing'>;
type Origin = { lineId:string; kind:'body'|'translation'|'romanization'; trackId?:string; contentId?:string; plain?:boolean; name:string };
export type LyricOutputProjection = { document:LyricDocument; origins:Map<string,Origin>; selected:string[] };

/** The existing project output selection owns all file formats. TTML carries the full document. */
export function projectLyricOutput(project:OutputProject, format:DownloadFormat):LyricOutputProjection {
 const {lyrics,karaoke}=project, origins=new Map<string,Origin>();
 if(format==='ttml')return {document:lyrics,origins,selected:karaoke.outputs};
 const rows:LyricLine[]=[];
 const bracket=['txt','lrc','elrc','eslrc','qrc','yrc'].includes(format);
 const append=(line:LyricLine,origin:Origin)=>{
  if(!line.words.some(word=>word.text.length))return;
  const words=line.words.map(word=>({...word,rubyUnits:[]}));
  if(bracket&&line.backgroundOf){
   const first=words.findIndex(word=>word.text.trim()),last=words.length-1-[...words].reverse().findIndex(word=>word.text.trim());
   if(first>=0){words[first].text='（'+words[first].text;words[last].text+='）';}
  }
  rows.push({...line,words,backgroundOf:bracket?null:line.backgroundOf});origins.set(line.id,origin);
 };
 for(const [ordinal,line] of lyrics.lines.entries()){
  const group=karaoke.lineGroups[line.id];
  if(karaoke.outputs.includes(outputId(group)))append(line,{lineId:line.id,kind:'body',name:`L${ordinal+1}`});
  for(const kind of ['translation','romanization'] as const){
   const tracks=lyrics[kind==='translation'?'translationTracks':'romanizationTracks'];
   tracks.forEach((track,index)=>{
    if(!karaoke.outputs.includes(outputId(group,kind,track.id)))return;
    for(const content of track.contents.filter(content=>content.lineId===line.id)){
     const words=content.kind==='plain'?[{...createWord(content.text,content.id),beginMs:line.beginMs,endMs:format==='elrc'?null:line.endMs}]:content.units.map(unit=>({...createWord(unit.text,unit.id),beginMs:unit.beginMs,endMs:unit.endMs}));
     const endpoints=(key:'beginMs'|'endMs')=>content.kind==='plain'?line[key]:words.some(word=>word[key]===null)?null:words.length?(key==='beginMs'?Math.min:Math.max)(...words.map(word=>word[key]!)):null;
     append({...createLine('',content.id),words,beginMs:endpoints('beginMs'),endMs:endpoints('endMs'),backgroundOf:line.backgroundOf},{lineId:line.id,kind,trackId:track.id,contentId:content.id,plain:content.kind==='plain',name:`L${ordinal+1} ${kind==='translation'?'Translation':'Romanization'} ${index+1} ${track.language??'und'}${'purpose' in track?` ${track.purpose}`:''}`});
    }
   });
  }
 }
 if(format!=='txt')rows.sort((a,b)=>(a.beginMs??Infinity)-(b.beginMs??Infinity));
 return {document:{...lyrics,lines:rows,translationTracks:[],romanizationTracks:[]},origins,selected:karaoke.outputs};
}
export function sourceOutputIssue(issue:OutputIssue,projection:LyricOutputProjection):OutputIssue {
 const origin=projection.origins.get(issue.lineId);
 if(!origin||origin.kind==='body')return issue;
 const unit=issue.kind==='word'&&!origin.plain;
 return {...issue,lineId:origin.lineId,kind:origin.plain&&issue.kind==='line'?'line':`${origin.kind}-${unit?'unit':'content'}`,trackId:origin.trackId,contentId:origin.contentId,unitId:unit?issue.wordId:undefined,wordId:undefined};
}
export function prepareLyricDownload(project:OutputProject,format:DownloadFormat,title:string){
 const projection=projectLyricOutput(project,format);
 let files:{name:string;text:string}[]=[], issues:OutputIssue[]=[];
 let archiveFiles:({name:string;text:string}|{name:string;data:Uint8Array<ArrayBuffer>})[]=[];
 try{
  if(format==='nicokara'||format==='sug'){
   if(format==='sug'){const result=prepareSug(project,title);files=result.files;issues=result.issues;archiveFiles=[...result.files,{name:'summary.txt',text:result.summary}];}
   else{const result=prepareNicokara(project,title);files=result.files;issues=result.issues;archiveFiles=nicokaraArchiveFiles(result);}
  }else if(!projection.document.lines.length){
   issues=[{kind:'line',lineId:'',karaokeSettings:true,code:'output-configuration',missing:[],detail:message('output.noSelectedContent'),message:'output.noSelectedContent'}];
  }else{
   let text:string;
   if(format==='ass'){
    const prepared=prepareAss(projection.document,project.editing);
    if(prepared.issues.length)throw new DocumentOutputError(prepared.issues);
    text=renderAss(prepared.events.map((event,index)=>{
     const origin=projection.origins.get(projection.document.lines[index].id)!;
     return {...event,role:origin.kind==='body'?event.role:origin.kind==='translation'?'Translation':'Romanization',name:origin.name,...(origin.plain?{units:undefined}:{})};
    }));
   }else text=exportLyricFile(projection.document,format,project.editing);
   const kinds=[...new Set([...projection.origins.values()].map(origin=>origin.kind))];
   const suffix=kinds.length&&!kinds.includes('body')?`.${kinds.join('-')}`:'';
   files=[{name:`${safeFilename(title)}${suffix}.${format==='elrc'?'lrc':format}`,text}];
  }
 }catch(cause){
  issues=cause instanceof DocumentOutputError?cause.issues:[{kind:'line',lineId:'',missing:[],code:'serialization',detail:errorMessage(cause),message:cause instanceof Error?cause.message:String(cause)}];
 }
 return {files,archiveFiles,projection,issues:issues.map(issue=>({...sourceOutputIssue(issue,projection),severity:issue.severity??'error' as const,formats:[format==='nicokara'?'Nicokara':format.toUpperCase()]}))};
}
export function defaultOutputProject(lyrics:LyricDocument,editing:ProjectDocument['editing']):OutputProject {
 return {lyrics,editing,karaoke:createKaraoke(lyrics)};
}
