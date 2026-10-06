import type { ProjectEditing } from '../domain/project-editing';
import type { LyricDocument, RomanizationContent } from '../domain/lyric-document';
import type { OutputIssue } from './output-validation';
import { isUntimedSeparator, projectExportSeparators, type ExportUnit } from './export-separators';

type AssEvent = { begin: number; end: number; role: 'Main' | 'Background' | 'Translation' | 'Romanization'; name: string; units?: ExportUnit[]; text: string };
const cs = (ms: number) => Math.round(ms / 10);
const stamp = (value: number) => `${Math.floor(value / 360000)}:${String(Math.floor(value / 6000) % 60).padStart(2,'0')}:${String(Math.floor(value / 100) % 60).padStart(2,'0')}.${String(value % 100).padStart(2,'0')}`;

/** Both validation and serialization consume this exact projection, never the playback selection. */
export function prepareAss(document: LyricDocument, editing?: ProjectEditing): { events: AssEvent[]; issues: OutputIssue[] } {
  const events: AssEvent[] = [], issues: OutputIssue[] = [];
  const ordinals = new Map(document.lines.filter(line=>!line.backgroundOf).map((line,index)=>[line.id,index+1]));
  for (const line of document.lines) {
    const label = `第 ${ordinals.get(line.backgroundOf ?? line.id)} 行${line.backgroundOf ? ' · 背景' : ''}`;
    const lineBase = { kind: 'line' as const, lineId: line.id };
    const problem = (base: Omit<OutputIssue,'missing'|'message'>, reason: string, missing: OutputIssue['missing'] = []) => {
      let context = '';
      if (base.wordId) context = `第 ${line.words.findIndex(word=>word.id===base.wordId)+1} 词`;
      if (base.trackId) {
        const translation = base.kind.startsWith('translation');
        const tracks = translation ? document.translationTracks : document.romanizationTracks;
        const index = tracks.findIndex(track=>track.id===base.trackId), track = tracks[index];
        const contentIndex = track.contents.findIndex(content=>content.id===base.contentId), content = track.contents[contentIndex];
        context = ` · ${translation ? '翻译' : '音译'} ${track.language ?? '未指定语言'} 轨道 ${index+1} 内容 ${contentIndex+1}`;
        if (base.unitId && content.kind === 'timed') context += `第 ${content.units.findIndex(unit=>unit.id===base.unitId)+1} 单元`;
      }
      issues.push({ ...base, missing, message: `${label}${context}：${reason}` });
    };
    const range = (unit: ExportUnit, base: Omit<OutputIssue,'missing'|'message'>) => {
      const missing: OutputIssue['missing'] = [...(unit.beginMs === null ? ['begin' as const] : []), ...(unit.endMs === null ? ['end' as const] : [])];
      if (missing.length) { problem({ ...base, code: 'missing-time' }, `缺少${missing.length === 2 ? '开始和结束' : missing[0] === 'begin' ? '开始' : '结束'}时间`, missing); return false; }
      if (!Number.isFinite(unit.beginMs) || !Number.isFinite(unit.endMs) || unit.beginMs! < 0 || unit.endMs! < unit.beginMs!) { problem({ ...base, code: 'invalid-range' }, '时间区间无效'); return false; }
      return true;
    };
    const textCheck = (text: string, base: Omit<OutputIssue,'missing'|'message'>) => {
      if (/[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f]/u.test(text)) problem({ ...base, code: 'serialization' }, 'ASS 不能忠实表达制表符或控制字符');
    };
    const lineValid = range({ ...line, text: '' }, lineBase);
    if (lineValid && cs(line.endMs!) <= cs(line.beginMs!)) problem({ ...lineBase, code: 'invalid-range' }, 'ASS 行边界量化到厘秒后必须有正时长');
    const timed = (source: ExportUnit[], base: Omit<OutputIssue,'missing'|'message'>, unitBase: (unit: ExportUnit)=>Omit<OutputIssue,'missing'|'message'>, body: boolean) => {
      const projection = projectExportSeparators(source,body ? editing : undefined);
      if (!projection.units.length) problem({ ...base, code: 'empty-content' }, body ? '该行没有可输出的定时正文' : '该定时内容没有可输出的定时单元');
      for (const unit of projection.unhosted) problem({ ...unitBase(unit), code: 'missing-time' }, '分隔空白没有相邻的有效定时单元');
      let previousEnd: number | null = null;
      for (const unit of source) {
        textCheck(unit.text, unitBase(unit));
        if (isUntimedSeparator(unit,body ? editing : undefined)) continue;
        if (!range(unit, unitBase(unit))) continue;
        if (previousEnd !== null && unit.beginMs! < previousEnd) problem({ ...unitBase(unit), code: 'unsupported-order' }, 'ASS 无法表达同一事件内的单元重叠或倒序');
        if (body && lineValid && (unit.beginMs! < line.beginMs! || unit.endMs! > line.endMs!)) problem({ ...unitBase(unit), code: 'invalid-range' }, 'ASS 正文单元超出所属行边界');
        previousEnd = unit.endMs;
      }
      return projection.units;
    };
    const units = timed(line.words, lineBase, unit=>({kind:'word',lineId:line.id,wordId:unit.id}),true);
    events.push({begin:cs(line.beginMs!),end:cs(line.endMs!),role:line.backgroundOf ? 'Background' : 'Main',name:`L${ordinals.get(line.backgroundOf ?? line.id)}${line.backgroundOf ? '-bg' : ''}`,units,text:units.map(u=>u.text).join('')});
    const append = (content: RomanizationContent, role: 'Translation'|'Romanization', trackId: string, name: string) => {
      const kind = role === 'Translation' ? 'translation' : 'romanization';
      const base = {kind:`${kind}-content` as const,lineId:line.id,trackId,contentId:content.id};
      if (content.kind === 'plain') {
        textCheck(content.text,base);
        events.push({begin:cs(line.beginMs!),end:cs(line.endMs!),role,name,text:content.text});
      } else {
        const units = timed(content.units,base,unit=>({...base,kind:`${kind}-unit` as const,unitId:unit.id}),false);
        const endpoints = units.filter(u=>u.beginMs!==null&&u.endMs!==null);
        const begin = cs(Math.min(...endpoints.map(u=>u.beginMs!))), end = cs(Math.max(...endpoints.map(u=>u.endMs!)));
        if (endpoints.length && end <= begin) problem({...base,code:'invalid-range'},'ASS 定时内容包络量化到厘秒后必须有正时长');
        events.push({begin,end,role,name,units,text:units.map(u=>u.text).join('')});
      }
    };
    document.translationTracks.forEach((track,index)=>track.contents.filter(c=>c.lineId===line.id).forEach((content,number)=>append(content,'Translation',track.id,`L${ordinals.get(line.backgroundOf ?? line.id)}${line.backgroundOf?'-bg':''} Translation ${index+1}.${number+1} ${track.language??'und'} ${track.purpose}`)));
    document.romanizationTracks.forEach((track,index)=>track.contents.filter(c=>c.lineId===line.id).forEach((content,number)=>append(content,'Romanization',track.id,`L${ordinals.get(line.backgroundOf ?? line.id)}${line.backgroundOf?'-bg':''} Romanization ${index+1}.${number+1} ${track.language??'und'}`)));
  }
  return { events, issues };
}

/** A WORD JOINER after a literal slash prevents ASS's \N/\n/\h escapes without a visible glyph. */
function literal(text: string) { return text.replace(/\\/g,'\\\u2060').replace(/\{/g,'\\{').replace(/\}/g,'\\}'); }
const graphemes = new Intl.Segmenter(undefined,{granularity:'grapheme'});
function eventText(event: AssEvent) {
  let columns = 0, rows = 1;
  const wrap = (text: string) => Array.from(graphemes.segment(text.replace(/\r\n?/g,'\n')),part=>{
    const char = part.segment;
    if (/[\n\u2028\u2029]/u.test(char)) { columns=0;rows++;return '\\N'; }
    const width = /^[\u0020-\u007e\u00a0]$/u.test(char) ? 1 : 2;
    let prefix='';if(columns+width>64){prefix='\\N';columns=0;rows++;}
    columns+=width;return prefix+literal(char);
  }).join('');
  if (!event.units) return { text:wrap(event.text), rows };
  let cursor=event.begin,text='';
  for(const unit of event.units) {
    const begin=cs(unit.beginMs!),end=cs(unit.endMs!);
    // Keep an invisible glyph in empty timing segments: libass otherwise merges adjacent k tags.
    if(begin>cursor)text+=`{\\k${begin-cursor}}\u2060`;
    text+=`{\\k${end-begin}}${wrap(unit.text)}`;cursor=end;
  }
  return { text, rows };
}
export function renderAss(events: AssEvent[]): string {
  // Allocate contiguous rows over actual event intervals, including independent attachment envelopes.
  const occupied: number[] = [];
  const placed = [...events].sort((a,b)=>a.begin-b.begin).map(event=>{
    const content=eventText(event);let lane=0;
    while(Array.from({length:content.rows},(_,i)=>occupied[lane+i]??-1).some(end=>end>event.begin))lane++;
    for(let i=0;i<content.rows;i++)occupied[lane+i]=event.end;
    return {...event,...content,lane};
  });
  const height=Math.max(1080,96+occupied.length*64);
  const style=(name:string,size:number,color:string)=>`Style: ${name},Arial,${size},${color},&H00909090,&H00101010,&H80000000,0,0,0,0,100,100,0,0,1,2,0,8,48,48,48,1`;
  return '\uFEFF'+[
    '[Script Info]','; Generated by Lazulite Studio','ScriptType: v4.00+','PlayResX: 1920',`PlayResY: ${height}`,'LayoutResX: 1920',`LayoutResY: ${height}`,'ScaledBorderAndShadow: yes','YCbCr Matrix: None','WrapStyle: 2','',
    '[V4+ Styles]','Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    style('Main',40,'&H00FFFFFF'),style('Background',32,'&H00D8F0FF'),style('Translation',28,'&H00E0FFE0'),style('Romanization',28,'&H00FFE8D0'),'',
    '[Events]','Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    ...placed.map(event=>`Dialogue: 0,${stamp(event.begin)},${stamp(event.end)},${event.role},${event.name.replace(/[,\r\n]/g,' ')},0,0,0,,{\\an8\\pos(960,${48+event.lane*64})}${event.text}`),'',
  ].join('\n');
}
