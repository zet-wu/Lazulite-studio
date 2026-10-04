import { AGENT_TYPES } from '../domain/lyric-document';
import type { LyricDocument, LyricLine, TimeMs } from '../domain/lyric-document';
import type { LyricFormat } from './lyric-formats';
export type OutputIssue = {
  kind: 'agent' | 'line' | 'word' | 'ruby' | 'romanization-content' | 'romanization-unit' | 'translation-content' | 'translation-unit';
  lineId: string; agentId?: string; wordId?: string; rubyId?: string; trackId?: string; contentId?: string; unitId?: string;
  code?: 'invalid-agent-type' | 'missing-time' | 'invalid-range' | 'unsupported-order' | 'empty-content';
  missing: ('begin' | 'end')[]; message: string;
};
export class DocumentOutputError extends Error {
  constructor(readonly issues: OutputIssue[]) { super(issues[0].message); }
}
export function visibleLineOrdinals(document: LyricDocument) { return new Map(document.lines.filter(l=>!l.backgroundOf).map((l,i)=>[l.id,i+1])); }
export function collectOutputIssues(document: LyricDocument, target: LyricFormat | 'publish'): OutputIssue[] {
 const issues: OutputIssue[] = [], ordinals=visibleLineOrdinals(document);
 if (target === 'ttml' || target === 'publish') for (const agent of document.agents) if (!AGENT_TYPES.some(type => type === agent.type)) issues.push({ kind: 'agent', lineId: '', agentId: agent.id, code: 'invalid-agent-type', missing: [], message: `歌手 ${agent.id}：${agent.type ? `非法 type ${agent.type}` : '缺少 type'}` });
 const label=(line: LyricLine)=>`第 ${ordinals.get(line.backgroundOf ?? line.id)} 行${line.backgroundOf ? ' · 背景' : ''}`;
 const add=(base: Omit<OutputIssue,'missing'|'message'>, prefix: string, begin: TimeMs, end: TimeMs, requireEnd: boolean, extra?: string)=>{
   const missing: OutputIssue['missing'] = [...(begin === null ? ['begin' as const] : []), ...(requireEnd && end === null ? ['end' as const] : [])];
   const reason=missing.length ? `缺少${missing.length===2 ? '开始和结束' : missing[0]==='begin' ? '开始' : '结束'}时间` : extra;
   if(reason)issues.push({...base,code: missing.length ? 'missing-time' : target === 'elrc' ? 'unsupported-order' : 'invalid-range',missing,message:`${prefix}：${reason}`});
 };
 const fullBody=target==='publish' || !['ttml','lrc','elrc','txt'].includes(target);
 const lrc=target==='lrc' || target==='elrc';
 for(const line of document.lines) {
   if ((lrc || target==='txt') && line.backgroundOf) continue;
   const base={kind:'line' as const,lineId:line.id},prefix=label(line);
   if(fullBody || lrc) add(base,prefix,line.beginMs,line.endMs,fullBody,line.beginMs!==null && line.endMs!==null && (fullBody ? line.endMs<=line.beginMs : line.endMs<line.beginMs) ? '结束时间必须晚于开始' : undefined);
   let boundary=line.beginMs === null ? null : line.beginMs;
   for(const [i,word] of line.words.entries()) {
     const blank=/^\s+$/.test(word.text) && word.beginMs===null && word.endMs===null && !word.rubyUnits.length && !word.emptyBeat;
     if(blank)continue;
     const wordBase={kind:'word' as const,lineId:line.id,wordId:word.id},wordPrefix=`${prefix}第 ${i+1} 词`;
     const begin=fullBody && target!=='publish' && line.words.length===1 ? word.beginMs ?? line.beginMs : word.beginMs;
     const end=fullBody && target!=='publish' && line.words.length===1 ? word.endMs ?? line.endMs : word.endMs;
     if(fullBody) add(wordBase,wordPrefix,begin,end,true);
     if(target==='elrc') {
       const b=begin === null ? null : begin,e=end===null ? null : end;
       const wrong=(b!==null && boundary!==null && b<boundary) || (b!==null && e!==null && e<b);
       add(wordBase,wordPrefix,begin,end,false,wrong ? '时间倒序或重叠，无法输出扩展 LRC' : undefined);
       if(b!==null)boundary=e ?? b;
     }
     if(target==='publish') for(const [j,ruby] of word.rubyUnits.entries()) add({kind:'ruby',lineId:line.id,wordId:word.id,rubyId:ruby.id},`${wordPrefix}第 ${j+1} 读音单元`,ruby.beginMs,ruby.endMs,true);
   }
 }
 if(target==='ttml' || target==='publish') for(const [index,track] of document.romanizationTracks.entries()) {
   const duplicate=document.romanizationTracks.filter(t=>t.language===track.language).length>1;
   for(const content of track.contents) {
     const line=document.lines.find(l=>l.id===content.lineId);
     if(!line)continue; // Internal document validation owns unknown references.
     const prefix=`${label(line)} · ${track.language ?? '未指定语言'}${duplicate ? ` 轨道 ${index+1}` : ''} 音译`;
     if(content.kind==='timed') {
       if(!content.units.length)issues.push({kind:'romanization-content',lineId:line.id,trackId:track.id,contentId:content.id,code:'empty-content',missing:[],message:`${prefix}：定时内容没有单元`});
       for(const [i,unit] of content.units.entries()) {
         if(/^\s+$/.test(unit.text) && unit.beginMs===null && unit.endMs===null)continue;
         add({kind:'romanization-unit',lineId:line.id,trackId:track.id,contentId:content.id,unitId:unit.id},`${prefix}第 ${i+1} 单元`,unit.beginMs,unit.endMs,true);
       }
     }
   }
 }
 if (target === 'ttml' || target === 'publish') for (const line of document.lines) for (const content of line.translations) if (content.kind === 'timed') {
   if (!content.units.length) issues.push({ kind: 'translation-content', lineId: line.id, contentId: content.id, code: 'empty-content', missing: [], message: `${label(line)}翻译没有单元` });
   for (const [index, unit] of content.units.entries()) add({ kind: 'translation-unit', lineId: line.id, contentId: content.id, unitId: unit.id }, `${label(line)}翻译第 ${index + 1} 单元`, unit.beginMs, unit.endMs, true, unit.beginMs !== null && unit.endMs !== null && unit.beginMs > unit.endMs ? '时间倒序' : undefined);
 }
 return issues;
}
export function assertOutputDocument(document: LyricDocument,target: LyricFormat | 'publish') { const issues=collectOutputIssues(document,target);if(issues.length)throw new DocumentOutputError(issues); }

export function outputIssueKey(issue: OutputIssue) {
 return JSON.stringify([issue.kind,issue.agentId,issue.lineId,issue.wordId,issue.rubyId,issue.trackId,issue.contentId,issue.unitId,issue.code ?? 'missing-time',issue.missing]);
}
export function uniqueOutputIssues(issues: OutputIssue[]) {
 return [...new Map(issues.map(issue=>[outputIssueKey(issue),issue])).values()];
}
