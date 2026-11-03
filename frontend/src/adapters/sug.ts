import { songInformation } from './song-information';
import { message as describeMessage } from '../domain/messages';
import { karaokeOutputs, karaokeFilenames, zipFiles } from './karaoke-output';
import { isUntimedSeparator, type ExportUnit } from './export-separators';
import { cueProblem, cueWord, type KaraokeCue } from '../domain/karaoke';
import { singerSet } from '../domain/singer-markers';
import type { LyricLine, LyricWord } from '../domain/lyric-document';
import type { ProjectDocument } from '../domain/project-document';
import { DocumentOutputError, outputIssueKey, type OutputIssue } from './output-validation';

export type SugCharacter = { id: string; char: string; timestamps: number[]; check_count: number; linked_to_next: boolean; is_sentence_end: boolean; sentence_end_ts: number | null; is_line_end: boolean; singer_id: string; is_guide: boolean; ruby?: { parts: { text: string; offset_ms: number }[] } };
type Sentence = { id: string; singer_id: string; characters: SugCharacter[] };
type Target = Partial<OutputIssue>;
type Segment = { text: string; begin: number; end: number; target: Target; singer: string; separator?: boolean; guide?: boolean; reading?: { text: string; begin: number; end: number }[] };

/** Project-format boundary: diagnostics and products always use the same snapshot. */
export function prepareSug(project: Pick<ProjectDocument, 'lyrics' | 'karaoke' | 'editing'>, title: string, now = new Date()) {
  const outputs = karaokeOutputs(project), names = karaokeFilenames(outputs, title, 'sug');
  const issues: OutputIssue[] = [], omitted: string[] = [];
  const files: { name: string; text: string; output: typeof outputs[number] }[] = [];
  const descriptions: string[] = [];
  const { lyrics, karaoke } = project;
  const add = (target: Target, message: string, outputIds: string[] = [], code: OutputIssue['code'] = 'serialization') => issues.push({kind:'line',lineId:'',missing:[],...target,message,detail:describeMessage(message),code,severity:'error',formats:['SUG'],outputIds});
  for (const line of lyrics.lines) if (!karaoke.groups.some(g => g.id === karaoke.lineGroups[line.id])) add({lineId:line.id,karaokeSettings:true},'output.groupRequired');
  if (!karaoke.outputs.length) add({karaokeSettings:true},'output.chooseFiles', [], 'output-configuration');
  for (const id of new Set(karaoke.outputs)) {
    const output = outputs.find(o => o.id === id);
    if (!output) { add({karaokeSettings:true},'output.staleSelection',[id]); continue; }
    const issue = (target: Target, message: string, code?: OutputIssue['code']) => add(target,message,[id],code);
    const offset = karaoke.offsets[id] ?? 0;
    if (!Number.isSafeInteger(offset)) issue({karaokeSettings:true},'output.integerOffset','invalid-range');
    const valid = (unit: ExportUnit, target: Target): unit is ExportUnit & {beginMs:number;endMs:number} => {
      const {beginMs:b,endMs:e} = unit;
      if (b === null || e === null) { issue({...target,missing:[...(b===null?['begin' as const]:[]),...(e===null?['end' as const]:[])]},'output.bothTimes','missing-time'); return false; }
      if (!Number.isSafeInteger(b)||!Number.isSafeInteger(e)||b<0||e<=b) { issue(target,'output.positiveRange','invalid-range'); return false; }
      return true;
    };
    const textOk = (text:string,target:Target) => { if (/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(text)) issue(target,'output.sugControl'); };
    const singers = [{id:'singer-0',name:'未指定',is_default:true,color:'#FF6B6B'}];
    const roles = new Map<string,string>([['[]','singer-0']]);
    const singerFor = (line:LyricLine, word:LyricWord, target:Target) => {
      const set = singerSet(lyrics,line,word);
      if (set.missing) issue(target,'output.singerStale');
      const existing = roles.get(set.key); if (existing) return existing;
      const label = set.ids.map(agentId=>{const a=lyrics.agents.find(a=>a.id===agentId)!;return a.name || `歌手 ${lyrics.agents.indexOf(a)+1}`;}).join('+');
      let name=label,n=2;while(singers.some(s=>s.name===name))name=`${label} (${n++})`;
      const singerId=`singer-${singers.length}`;roles.set(set.key,singerId);singers.push({id:singerId,name,is_default:false,color:'#FF6B6B'});
      if(set.ids.length>1)descriptions.push(`${output.label}：组合角色 ${name} = ${label}`);
      return singerId;
    };
    const lineSinger = (line:LyricLine,target:Target) => singerFor(line,{...line.words[0],agentRefs:undefined} as LyricWord,target);
    const cueSegment = (cue:KaraokeCue): Segment | null => {
      const target={lineId:cue.anchor.lineId,cueId:cue.id};
      const problem=cueProblem(lyrics,karaoke,cue);if(problem)issue(target,problem,'invalid-range');
      if(!valid({...cue,id:cue.id},target))return null;
      textOk(cue.text,target);
      if(cue.anchor.kind==='ruby'&&/[\^＾]/.test(cue.text))issue(target,'output.sugCuePause');
      const line=lyrics.lines.find(l=>l.id===cue.anchor.lineId)!,word=cueWord(lyrics,cue);
      return {text:cue.text,begin:cue.beginMs,end:cue.endMs,target,singer:word?singerFor(line,word,target):'singer-0',guide:true};
    };
    let charIndex=0;
    const sentences:Sentence[]=[];
    const emit = (segments:Segment[], target:Target) => {
      if(!segments.length)return;
      let previous=-1,maxEnd=-1;
      const characters:SugCharacter[]=[];
      for(const segment of segments){
        textOk(segment.text,segment.target);
        if(segment.begin<previous)issue(segment.target,'output.sugOrder','unsupported-order');
        previous=segment.begin;maxEnd=Math.max(maxEnd,segment.end);
        if([segment.begin,segment.end].some(t=>!Number.isSafeInteger(t+offset)||t+offset<0)){issue(segment.target,'output.offsetRange','invalid-range');if(!issues.some(i=>i.karaokeSettings&&i.outputIds?.includes(id)))issue({karaokeSettings:true},'output.adjustOffset','invalid-range');}
        const chars=Array.from(segment.text);
        chars.forEach((char,index)=>{
          const first=index===0,last=index===chars.length-1;
          const timestamps=first?(segment.reading?.map(p=>p.begin)??[segment.begin]):[];
          characters.push({id:`char-${charIndex++}`,char,timestamps,check_count:timestamps.length,linked_to_next:!last,is_sentence_end:last,sentence_end_ts:last?segment.end:null,is_line_end:false,singer_id:segment.singer,is_guide:!!segment.guide,...(first&&segment.reading?{ruby:{parts:segment.reading.map((p,i,parts)=>({text:p.text,offset_ms:i?p.begin-parts[0].begin:0}))}}:{})});
        });
      }
      if(segments.at(-1)!.end<maxEnd)issue(target,'output.sugShortEnvelope','unsupported-order');
      if(characters.length){characters.at(-1)!.is_line_end=true;sentences.push({id:`sentence-${sentences.length}`,singer_id:'singer-0',characters});}
    };
    const mapUnits = (units:ExportUnit[], targetFor:(u:ExportUnit)=>Target, singer:(u:ExportUnit)=>string, body=false):Segment[] => {
      const result:Segment[]=[];
      for(let i=0;i<units.length;i++){
        const unit=units[i],target=targetFor(unit);if(!unit.text.length)continue;
        if(isUntimedSeparator(unit,body?project.editing:undefined)){
          let before=i-1,after=i+1;
          while(before>=0&&isUntimedSeparator(units[before],body?project.editing:undefined))before--;
          while(after<units.length&&isUntimedSeparator(units[after],body?project.editing:undefined))after++;
          const host=before>=0?units[before]:units[after];
          if(!host||host.beginMs===null||host.endMs===null||host.endMs<=host.beginMs){issue(target,'validation.unhostedSeparator','missing-time');continue;}
          const t=before>=0?host.endMs:host.beginMs;
          // Every separator is independent, including consecutive spaces.
          for(const text of Array.from(unit.text))result.push({text,begin:t,end:t,target,singer:singer(unit),separator:true});
          continue;
        }
        if(!valid(unit,target))continue;
        const segment:Segment={text:unit.text,begin:unit.beginMs,end:unit.endMs,target,singer:singer(unit)};
        if(body){
          const word=unit as LyricWord;
          const reading:{text:string;begin:number;end:number}[]=[];
          for(const [index,ruby] of word.rubyUnits.entries()){
            const rt={...target,kind:'ruby' as const,rubyId:ruby.id};textOk(ruby.reading,rt);
            if(!ruby.reading.length||ruby.reading.includes('^pause^')||/[\^＾]/.test(ruby.reading))issue(rt,'output.sugReading');
            if(!valid({...ruby,text:ruby.reading},rt))continue;
            if(ruby.beginMs!<unit.beginMs||ruby.endMs!>unit.endMs||index>0&&ruby.beginMs!<(word.rubyUnits[index-1].endMs??Infinity))issue(rt,'output.rubyRange','invalid-range');
            reading.push({text:ruby.reading,begin:index===0?unit.beginMs:ruby.beginMs!,end:index===word.rubyUnits.length-1?unit.endMs:ruby.endMs!});
            for(const cue of karaoke.cues.filter(c=>c.anchor.kind==='ruby'&&c.anchor.wordId===word.id&&c.anchor.leftId===ruby.id)){const s=cueSegment(cue);if(s)reading.push(s);}
          }
          if(reading.length){
            segment.reading=[];
            for(const part of reading){const prev=segment.reading.at(-1);if(prev&&part.begin>prev.end)segment.reading.push({text:'^pause^',begin:prev.end,end:part.begin});segment.reading.push(part);}
          }
        }
        result.push(segment);
        if(body)for(const cue of karaoke.cues.filter(c=>c.anchor.kind==='word'&&c.anchor.lineId===target.lineId&&c.anchor.leftId===unit.id)){const s=cueSegment(cue);if(s)result.push(s);}
      }
      return result;
    };
    for(const line of lyrics.lines.filter(l=>karaoke.lineGroups[l.id]===output.groupId)){
      const target={lineId:line.id};
      if(output.kind==='body'){
        for(const cue of karaoke.cues.filter(c=>c.anchor.lineId===line.id)){const problem=cueProblem(lyrics,karaoke,cue);if(problem)issue({...target,cueId:cue.id},problem,'invalid-range');}
        const before=karaoke.cues.filter(c=>c.anchor.kind==='before'&&c.anchor.lineId===line.id).sort((a,b)=>a.beginMs-b.beginMs).flatMap(c=>{const s=cueSegment(c);return s?[s]:[];});
        const body=mapUnits(line.words,u=>({...target,kind:'word',wordId:u.id}),u=>singerFor(line,u as LyricWord,{...target,kind:'word',wordId:u.id}),true);
        if(!body.some(s=>!s.separator))issue(target,'该行没有可输出的定时正文','empty-content');
        emit([...before,...body],target);
      }else{
        const track=lyrics[output.kind==='translation'?'translationTracks':'romanizationTracks'].find(t=>t.id===output.trackId)!;
        for(const content of track.contents.filter(c=>c.lineId===line.id)){
          const ct:Target={...target,kind:`${output.kind}-content`,trackId:track.id,contentId:content.id};
          if(content.kind==='timed')emit(mapUnits(content.units,u=>({...ct,kind:`${output.kind}-unit` as OutputIssue['kind'],unitId:u.id}),()=>lineSinger(line,ct)),ct);
          else if(content.text.length){
            const words=line.words.filter(w=>w.text.length&&!isUntimedSeparator(w,project.editing));
            if(!words.length||words.some(w=>!valid(w,{...target,kind:'word',wordId:w.id}))) {issue(target,'output.attachmentEnvelope','missing-time');continue;}
            emit([{text:content.text,begin:Math.min(...words.map(w=>w.beginMs!)),end:Math.max(...words.map(w=>w.endMs!)),target:ct,singer:lineSinger(line,ct)}],ct);
          }
        }
      }
    }
    if(!sentences.length){omitted.push(output.label);continue;}
    const date=now.toISOString();
    const information = songInformation(lyrics.metadata);
    const values = Object.fromEntries(information.map(item => [item.key, item.value]));
    const standard = { title: values.title || title, artist: values.artist, album: values.album };
    const nicokara_tags = { ...standard, custom: information.filter(item => !['title','artist','album'].includes(item.key) && item.value.trim()).map(item => `@${item.tag}=${item.value}`) };
    const data={nicokara_tags,version:'0.3.0',id:'project-0',metadata:{...standard,language:output.kind==='body'?(lyrics.language??''):(output.language==='und'?'':output.language),created_at:date,updated_at:date},audio_duration_ms:0,singers,sentences,global_offset_ms:offset};
    files.push({name:names.get(id)!,text:JSON.stringify(data,null,2)+'\n',output});
  }
  if(karaoke.outputs.length&&!files.length&&!issues.length)add({karaokeSettings:true},'output.chooseNonempty', [], 'output-configuration');
  const summary=[...files.map(f=>`${f.name} — ${f.output.label}；输出偏移 ${karaoke.offsets[f.output.id]??0} ms`),...descriptions,...omitted.map(label=>`空输出已省略：${label}`),'行采用正文词包络（含带出的导唱）；Ruby 首尾填满所属词，中间停顿保留。','无时间横向分隔保留原文，投影为零时长边界；在 SUG 打轴中成为额外检查点。','词内字符时间由接收端推导；正文与 Ruby 共用检查点。组合角色保留显示名称，集合关系不往返。','SUG 保留原始 Unicode 字符；Lin-K 可能将组合字符合并为显示字符（如 e＋组合重音变为 é）。','其他元数据、段落、脏词、agent 类型／actorRef、背景父子关联、附属轨道用途和原始对象身份没有对等映射。','不携带歌手图片、NKM3 触发标记、媒体或样式；时长 0 表示未知，.lazp 用于 Studio 工程备份。','解压并保留全部 SUG 文件；在 Lin-K 字幕视频生成中加载主文件，再逐个添加背景／翻译／音译副字幕源。','另选媒体、设置各源位置和样式；首次装配请将软件补偿和样式额外偏移设为 0，再按需要调整。','SUG 也可在打轴模块打开；零时长分隔会参与检查点导航。'].join('\n')+'\n';
  const merged = new Map<string, OutputIssue>();
  for(const issue of issues){const key=outputIssueKey(issue)+issue.message,previous=merged.get(key);merged.set(key,previous?{...previous,outputIds:[...new Set([...(previous.outputIds??[]),...(issue.outputIds??[])])]}:issue);}
  return {files,issues:[...merged.values()],omitted,summary};
}
export function sugZip(project:ProjectDocument,title:string){const result=prepareSug(project,title);if(result.issues.length)throw new DocumentOutputError(result.issues);return zipFiles([...result.files,{name:'summary.txt',text:result.summary}]);}
