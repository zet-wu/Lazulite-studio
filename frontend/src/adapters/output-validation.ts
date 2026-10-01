import type { LyricDocument, LyricLine, TimeUs } from '../domain/lyric-document';
import type { LyricFormat } from './lyric-formats';
export type OutputIssue = {
  kind: 'line' | 'word' | 'ruby' | 'romanization-content' | 'romanization-unit';
  lineId: string; wordId?: string; rubyId?: string; trackId?: string; contentId?: string; unitId?: string;
  missing: ('begin' | 'end')[]; message: string;
};
export class DocumentOutputError extends Error {
  constructor(readonly issues: OutputIssue[]) { super(issues[0].message); }
}
export function visibleLineOrdinals(document: LyricDocument) { return new Map(document.lines.filter(l=>!l.backgroundOf).map((l,i)=>[l.id,i+1])); }
export function collectOutputIssues(document: LyricDocument, target: LyricFormat | 'publish'): OutputIssue[] {
 const issues: OutputIssue[] = [], ordinals=visibleLineOrdinals(document);
 const label=(line: LyricLine)=>`第 ${ordinals.get(line.backgroundOf ?? line.id)} 行${line.backgroundOf ? ' · 背景' : ''}`;
 const add=(base: Omit<OutputIssue,'missing'|'message'>, prefix: string, begin: TimeUs, end: TimeUs, requireEnd: boolean, extra?: string)=>{
   const missing: OutputIssue['missing'] = [...(begin === null ? ['begin' as const] : []), ...(requireEnd && end === null ? ['end' as const] : [])];
   const reason=missing.length ? `缺少${missing.length===2 ? '开始和结束' : missing[0]==='begin' ? '开始' : '结束'}时间` : extra;
   if(reason)issues.push({...base,missing,message:`${prefix}：${reason}`});
 };
 const fullBody=target==='publish' || !['ttml','lrc','elrc','txt'].includes(target);
 const lrc=target==='lrc' || target==='elrc';
 for(const line of document.lines) {
   if ((lrc || target==='txt') && line.backgroundOf) continue;
   const base={kind:'line' as const,lineId:line.id},prefix=label(line);
   if(fullBody || lrc) add(base,prefix,line.beginUs,line.endUs,fullBody,line.beginUs!==null && line.endUs!==null && (fullBody ? line.endUs<=line.beginUs : Math.round(line.endUs/1000)<Math.round(line.beginUs/1000)) ? '结束时间必须晚于开始' : undefined);
   let boundary=line.beginUs === null ? null : Math.round(line.beginUs/1000);
   for(const [i,word] of line.words.entries()) {
     const blank=/^\s+$/.test(word.text) && word.beginUs===null && word.endUs===null && !word.rubyUnits.length && !word.alignmentUnits.length && !word.emptyBeat;
     if(blank)continue;
     const wordBase={kind:'word' as const,lineId:line.id,wordId:word.id},wordPrefix=`${prefix}第 ${i+1} 词`;
     const begin=fullBody && target!=='publish' && line.words.length===1 ? word.beginUs ?? line.beginUs : word.beginUs;
     const end=fullBody && target!=='publish' && line.words.length===1 ? word.endUs ?? line.endUs : word.endUs;
     if(fullBody) add(wordBase,wordPrefix,begin,end,true);
     if(target==='elrc') {
       const b=begin === null ? null : Math.round(begin/1000),e=end===null ? null : Math.round(end/1000);
       const wrong=(b!==null && boundary!==null && b<boundary) || (b!==null && e!==null && e<b);
       add(wordBase,wordPrefix,begin,end,false,wrong ? '时间倒序或重叠，无法输出扩展 LRC' : undefined);
       if(b!==null)boundary=e ?? b;
     }
     if(target==='publish') for(const [j,ruby] of word.rubyUnits.entries()) add({kind:'ruby',lineId:line.id,wordId:word.id,rubyId:ruby.id},`${wordPrefix}第 ${j+1} 读音单元`,ruby.beginUs,ruby.endUs,true);
   }
 }
 if(target==='ttml' || target==='publish') for(const [index,track] of document.romanizationTracks.entries()) {
   const duplicate=document.romanizationTracks.filter(t=>t.language===track.language).length>1;
   for(const content of track.contents) {
     const line=document.lines.find(l=>l.id===content.lineId);
     if(!line)continue; // Internal document validation owns unknown references.
     const prefix=`${label(line)} · ${track.language ?? '未指定语言'}${duplicate ? ` 轨道 ${index+1}` : ''} 音译`;
     if(content.kind==='timed') {
       if(!content.units.length)issues.push({kind:'romanization-content',lineId:line.id,trackId:track.id,contentId:content.id,missing:[],message:`${prefix}：定时内容没有单元`});
       for(const [i,unit] of content.units.entries()) {
         if(/^\s+$/.test(unit.text) && unit.beginUs===null && unit.endUs===null)continue;
         add({kind:'romanization-unit',lineId:line.id,trackId:track.id,contentId:content.id,unitId:unit.id},`${prefix}第 ${i+1} 单元`,unit.beginUs,unit.endUs,true);
       }
     }
   }
 }
 return issues;
}
export function assertOutputDocument(document: LyricDocument,target: LyricFormat | 'publish') { const issues=collectOutputIssues(document,target);if(issues.length)throw new DocumentOutputError(issues); }
