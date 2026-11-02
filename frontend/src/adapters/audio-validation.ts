import { message } from '../domain/messages';
import { lyricTimes } from '../domain/time-boundaries';
import type { Acoustics } from '../domain/project-document';
import type { LyricDocument } from '../domain/lyric-document';
import type { OutputIssue } from './output-validation';

export function audioRangeIssues(document: LyricDocument, acoustics: Acoustics | undefined, assetId: string | undefined, durationMs: number | undefined): OutputIssue[] {
  if (!assetId || durationMs === undefined) return [];
  const objects = [...lyricTimes(document), ...(acoustics?.segments ?? []).map(s => ({...s,kind:'acoustic' as const,lineId:''}))];
  return objects.flatMap(object => (['beginMs','endMs'] as const).flatMap(endpoint => {
    const value = object[endpoint];
    if (value === null || value <= durationMs) return [];
    const {id,kind,...references} = object;
    const line=document.lines.find(line=>line.id===object.lineId);
    const lineLabel=line ? `第 ${document.lines.filter(l=>!l.backgroundOf).findIndex(l=>l.id===(line.backgroundOf??line.id))+1} 行${line.backgroundOf?'（背景）':''}` : '';
    const names={line:'',word:'词',ruby:'注音', 'romanization-unit':'音译单元','translation-unit':'翻译单元',acoustic:'人声片段',cue:'导唱'};
    const label=kind==='acoustic'?`人声片段 ${(acoustics?.segments.findIndex(s=>s.id===id)??-1)+1}`:`${lineLabel}${names[kind]?` · ${names[kind]}`:''}`;
    if(kind === 'cue') return [];
    return [{...references,kind,segmentId:kind==='acoustic'?id:undefined,objectId:id,code:'audio-range' as const,severity:'warning' as const,formats:['audio-range'],missing:[],endpoint,sourceAssetId:assetId,sourceDurationMs:durationMs,excessMs:value-durationMs,
      detail:message(endpoint==='beginMs'?'validation.audioStart':'validation.audioEnd',{time:value,duration:durationMs,excess:value-durationMs}),
      message:`${label}的${endpoint==='beginMs'?'开始':'结束'}时间 ${value} ms 超过当前参考音频 ${durationMs} ms，超出 ${value-durationMs} ms`}];
  }));
}
