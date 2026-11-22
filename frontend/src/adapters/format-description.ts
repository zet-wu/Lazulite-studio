import { message, messageList, type Message } from '../domain/messages';
import type { LyricDocument } from '../domain/lyric-document';
import type { LyricFormat } from './lyric-formats';

export type FormatComparison = { element: string; result: string; status: 'preserved' | 'omitted' | 'partial'; detail: Message };
const elements = ['format.timing','batch.reading','capability.translation','capability.romanization','editor.background','format.overlap'];
const results: Record<Exclude<LyricFormat,'krc'|'sug'>,string[]> = {
 ttml:['preserved','preserved','preserved','preserved','preserved','preserved'],
 txt:['omitted','omitted','omitted','omitted','omitted','omitted'],
 lrc:['format.lrcResult','omitted','omitted','omitted','omitted','format.startLabels'],
 elrc:['format.elrcResult','omitted','omitted','omitted','omitted','format.startLabels'],
 eslrc:['format.eslrcResult','omitted','omitted','omitted','format.flatLines','format.wordEnvelope'],
 qrc:['preserved','omitted','omitted','omitted','format.parentheses','format.independentLines'],
 yrc:['preserved','omitted','omitted','omitted','format.parentheses','format.independentLines'],
 lys:['format.lysResult','omitted','omitted','omitted','format.backgroundFlag','format.wordEnvelope'],
 ass:['format.assResult','omitted','format.trackEvents','format.trackEvents','format.independentSubtitles','format.layoutNeeded'],
};
/** Only known, valid main-line intervals contribute; missing times never mean "no overlap". */
export function overlappingMainLines(document: LyricDocument): number[] {
 const rows=document.lines.filter(line=>!line.backgroundOf).map((line,index)=>({line,ordinal:index+1})).filter(({line})=>line.beginMs!==null&&line.endMs!==null&&line.endMs>line.beginMs).sort((a,b)=>a.line.beginMs!-b.line.beginMs!);
 const overlap=new Set<number>();let active: typeof rows=[];
 for(const row of rows){active=active.filter(other=>other.line.endMs!>row.line.beginMs!);for(const other of active){overlap.add(other.ordinal);overlap.add(row.ordinal);}active.push(row);}
 return [...overlap].sort((a,b)=>a-b);
}
/** TTML is the current Studio exchange baseline, not a claim of full TTML2 support. */
export function describeLyricFormat(document: LyricDocument, format: Exclude<LyricFormat,'krc'|'sug'>): FormatComparison[] {
 const overlap=overlappingMainLines(document);
 return elements.map((element,index)=>{
  const result=results[format][index];
  let detailKey=result==='preserved'?'format.preservedDetail':result==='omitted'?'format.omittedDetail':result;
  if(index===0){
   if(format==='lrc')detailKey='format.lrcDetail';
   if(format==='elrc')detailKey='format.elrcDetail';
   if(format==='eslrc')detailKey='format.eslrcDetail';
   if(format==='lys')detailKey='format.lysDetail';
   if(format==='ass')detailKey='format.assDetail';
  }
  if((index===2||index===3)&&format==='ass')detailKey='format.assAttachments';
  const parts: Message[]=[];
  if(index===4&&format!=='ttml'&&result!=='omitted')parts.push(message('format.backgroundDetail'));
  if(index===5){
   if(format==='ass')detailKey='format.assOverlap';
   if(format==='lrc'||format==='elrc')detailKey='format.lrcOverlap';
   if(overlap.length)parts.push(message('format.knownOverlap',{lines:overlap.join(', ')}));
  }
  return {element,result: result === 'preserved' ? 'format.preserved' : result === 'omitted' ? 'format.omitted' : result, status: result === 'preserved' || result === 'omitted' ? result : 'partial',detail:messageList([message(detailKey),...parts])};
 });
}

/** Describe the same selected content that preparation validates and serializes. */
export function describeSelectedOutput(project:import('./lyric-output').OutputProject,format:import('./lyric-output').DownloadFormat,projection:import('./lyric-output').LyricOutputProjection):FormatComparison[]{
 if(format==='ttml')return describeLyricFormat(project.lyrics,format);
 const multi=format==='nicokara'||format==='sug';
 const rows=multi?elements.map(element=>({element,result:'format.preserved',status:'preserved' as FormatComparison['status'],detail:message('format.preservedDetail')})):describeLyricFormat(projection.document,format);
 return rows.map((row,index)=>{
  const kind=index===2?'translation':index===3?'romanization':null;
  const selected=kind?[...projection.origins.values()].some(origin=>origin.kind===kind):index===4?projection.document.lines.some(line=>project.lyrics.lines.find(source=>source.id===projection.origins.get(line.id)?.lineId)?.backgroundOf):true;
  if((kind||index===4)&&!selected)return {...row,result:'format.omitted',status:'omitted',detail:message('format.notSelected')};
  if(multi&&index!==5){
   if(index===1&&!project.lyrics.lines.some(line=>projection.origins.get(line.id)?.kind==='body'&&line.words.some(word=>word.rubyUnits.length)))return {...row,result:'format.omitted',status:'omitted',detail:message('format.notSelected')};
   const key=index===0?(format==='sug'?'format.sugTimingOutput':'format.nicoTimingOutput'):index===1?'format.multiReading':index===4?'format.multiBackground':format==='sug'?'format.sugAttachments':'format.nicoAttachments';
   return {...row,result:index===0?(format==='sug'?'format.millisecondFiles':'format.centisecondFiles'):index===1?'format.multiReadingLabel':'format.multiFiles',status:'partial',detail:message(key)};
  }
  if(index===5){
   const sourceOrdinals=new Map(project.lyrics.lines.filter(line=>!line.backgroundOf).map((line,index)=>[line.id,index+1]));
   const overlaps=overlappingMainLines(projection.document);
   const lines=[...new Set(overlaps.map(ordinal=>{const row=projection.document.lines.filter(line=>!line.backgroundOf)[ordinal-1],origin=projection.origins.get(row.id),source=project.lyrics.lines.find(line=>line.id===origin?.lineId);return sourceOrdinals.get(source?.backgroundOf??source?.id??'');}).filter((value):value is number=>value!==undefined))];
   const base=multi?message('format.multiOverlap'):describeLyricFormat({...projection.document,lines:[]},format)[5].detail;
   return {...row,detail:messageList([base,...(lines.length?[message('format.knownOverlap',{lines:lines.join(', ')})]:[])])};
  }
  if(kind&&!multi)return {...row,result:format==='ass'?'format.trackEvents':'format.selectedRows',status:'partial',detail:message(format==='ass'?'format.assAttachments':'format.selectedRowsDetail')};
  if(index===4&&['txt','lrc','elrc'].includes(format))return {...row,result:'format.parentheses',status:'partial',detail:message('format.backgroundDetail')};
  return row;
 });
}
