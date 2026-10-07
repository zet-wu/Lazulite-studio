import type { LyricDocument } from '../domain/lyric-document';
import type { LyricFormat } from './lyric-formats';

export type FormatComparison = { element: string; result: string; status: 'preserved' | 'omitted' | 'partial'; detail: string };
const elements = ['时间（行／词）','注音','翻译','音译','背景','重叠主行'];
const results: Record<Exclude<LyricFormat,'krc'>,string[]> = {
 ttml:['preserved','preserved','preserved','preserved','preserved','preserved'],
 txt:['omitted','omitted','omitted','omitted','omitted','omitted'],
 lrc:['行开始、部分段尾','omitted','omitted','omitted','omitted','开始标签；可能无法同显'],
 elrc:['行／词时间；词倒序或重叠受限','omitted','omitted','omitted','omitted','开始标签；可能无法同显'],
 eslrc:['首词开始、各词结束','omitted','omitted','omitted','普通行；无关联','词包络；显示依播放器'],
 qrc:['preserved','omitted','omitted','omitted','括号；无关联','独立行时间；显示依播放器'],
 yrc:['preserved','omitted','omitted','omitted','括号；无关联','独立行时间；显示依播放器'],
 lys:['词时间；行界由词推导','omitted','omitted','omitted','背景标志；无关联','词包络；显示依播放器'],
 ass:['厘秒；词重叠受限','omitted','分轨字幕','分轨字幕','独立字幕；无关联','独立事件；需排版'],
};
/** Only known, valid main-line intervals contribute; missing times never mean "no overlap". */
export function overlappingMainLines(document: LyricDocument): number[] {
 const rows=document.lines.filter(line=>!line.backgroundOf).map((line,index)=>({line,ordinal:index+1})).filter(({line})=>line.beginMs!==null&&line.endMs!==null&&line.endMs>line.beginMs).sort((a,b)=>a.line.beginMs!-b.line.beginMs!);
 const overlap=new Set<number>();let active: typeof rows=[];
 for(const row of rows){active=active.filter(other=>other.line.endMs!>row.line.beginMs!);for(const other of active){overlap.add(other.ordinal);overlap.add(row.ordinal);}active.push(row);}
 return [...overlap].sort((a,b)=>a-b);
}
/** TTML is the current Studio exchange baseline, not a claim of full TTML2 support. */
export function describeLyricFormat(document: LyricDocument, format: Exclude<LyricFormat,'krc'>): FormatComparison[] {
 const overlap=overlappingMainLines(document);
 return elements.map((element,index)=>{
  const result=results[format][index];
  let detail=result==='preserved'?'相对当前 Studio TTML 导出保留此项内容与结构。':result==='omitted'?'不输出此项。':result;
  if(index===0){
   if(format==='lrc')detail='输出主行开始标签和可表达的段尾空标签；不保留逐词时间或重叠行各自的结束时间。';
   if(format==='elrc')detail='输出行开始与逐词标签；同一行内倒序或重叠不可输出，重叠主行各自的结束边界不能完整保留。';
   if(format==='eslrc')detail='只输出首词开始和每词结束，后词独立起点、间隙和重叠可能丢失；行边界由词包络推导。';
   if(format==='lys')detail='保留逐词端点；独立行边界由词包络替代。';
   if(format==='ass')detail='正文保留有效行边界；正文和定时翻译／音译的绝对端点统一量化到厘秒，再计算间隙与时长。短单元可能为零，文字保留但高亮精度降低；事件内单元重叠、倒序或正文越出行边界会阻塞。';
  }
  if((index===2||index===3)&&format==='ass')detail='每份内容分别形成事件，按样式、名称区分。普通内容使用所属行时间，定时内容使用独立包络；不保留原生轨道身份、关联或 replacement 语义，不代表容器内可选字幕流。';
  if(index===4&&format!=='ttml'&&result!=='omitted')detail+='；保留背景正文，不保留与主行的结构关联。';
  if(index===5){
   if(format==='ass')detail='各主行输出独立事件，默认按时间分配纵向位置；复杂多声部、长行及消费者字体差异仍需检查排版。';
   if(format==='lrc'||format==='elrc')detail='保留各行开始标签，不能完整保留重叠行各自的结束时间；同时显示取决于播放器。';
   if(overlap.length)detail+=` 当前已知时间有重叠，涉及主行：${overlap.join('、')}。`;
  }
  return {element,result: result === 'preserved' ? '保留' : result === 'omitted' ? '不输出' : result, status: result === 'preserved' || result === 'omitted' ? result : 'partial',detail};
 });
}
