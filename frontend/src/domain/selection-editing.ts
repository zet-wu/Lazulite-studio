import { splitAtGrapheme } from './text-boundaries';
import { consecutive, timeEnvelope, type LyricCommand } from './lyric-commands';
import { createProjectEditing, emptyBeatCount, type ProjectEditing } from './project-editing';
import { distributeRubyTime, isKanaReading, splitReadingMora } from './ruby-editing';
import type { LyricDocument, LyricLine, LyricWord, RubyUnit, RomanizationContent } from './lyric-document';

export type ObjectSelection =
  | { kind: 'lines'; ids: string[]; anchorId: string; activeId: string }
  | { kind: 'words'; lineId: string; ids: string[]; anchorId: string; activeId: string }
  | { kind: 'ruby'; lineId: string; wordId: string; ids: string[]; anchorId: string; activeId: string }
  | { kind: 'romanization-content'; attachment?: 'translation'; lineId: string; trackId: string; contentId: string; ids: string[]; anchorId: string; activeId: string }
  | { kind: 'romanization-unit'; attachment?: 'translation'; lineId: string; trackId: string; contentId: string; ids: string[]; anchorId: string; activeId: string };
export const attachmentTracks = (document: LyricDocument, selection: { attachment?: 'translation' }) => selection.attachment === 'translation' ? document.translationTracks : document.romanizationTracks;
export type SelectionAction = 'merge' | 'previous' | 'next' | 'beat' | 'redistribute' | 'mora' | 'tokenize' | 'split';

function moveGroup<T extends {id:string}>(siblings: T[], ids: string[], direction: -1 | 1) {
  const selected = ids.length === 1 ? siblings.filter(item => ids.includes(item.id)) : consecutive(siblings, ids);
  if (selected.length !== ids.length || !selected.length) throw new Error('选区已失效或跨父级');
  const first = siblings.indexOf(selected[0]), last = first + selected.length - 1;
  if (first + direction < 0 || last + direction >= siblings.length) throw new Error('选区已到达边界');
  const result = siblings.slice();
  result.splice(first, selected.length);
  result.splice(first + direction, 0, ...selected);
  return result;
}
export function attachmentSelection(document: LyricDocument, selection: Extract<ObjectSelection,{kind:'romanization-content'|'romanization-unit'}>) {
  const tracks = attachmentTracks(document,selection);
  if (selection.kind === 'romanization-content') {
    const owners = tracks.filter(track => track.contents.some(content => selection.ids.includes(content.id)));
    if (owners.length !== 1 || owners[0].id !== selection.trackId) throw new Error('请选择同一轨道的内容');
    const track = owners[0], selected = track.contents.filter(content => selection.ids.includes(content.id));
    if (selected.length !== selection.ids.length || !selected.length || selected.some(content => content.lineId !== selected[0].lineId)) throw new Error('请选择同一所属歌词行的有效内容');
    return { track, content: selected[0], contents: selected };
  }
  const owners = tracks.flatMap(track => track.contents.filter(content => content.kind === 'timed' && content.units.some(unit => selection.ids.includes(unit.id))).map(content => ({track,content})));
  if (owners.length !== 1 || owners[0].track.id !== selection.trackId || owners[0].content.id !== selection.contentId) throw new Error('请选择同一轨道、同一内容内的单元');
  const {track,content}=owners[0];
  if(content.kind !== 'timed' || content.units.filter(unit=>selection.ids.includes(unit.id)).length !== selection.ids.length) throw new Error('选区包含失效单元');
  return { track, content, contents:[content] };
}
export function planSelectionAction(document: LyricDocument, selection: ObjectSelection, action: SelectionAction, editing: ProjectEditing = createProjectEditing()): LyricCommand {
  const ids=selection.ids;
  if (!ids.length || new Set(ids).size !== ids.length) throw new Error('请选择有效对象');
  if (action === 'merge') {
    if (ids.length < 2) throw new Error('至少选择两个连续对象');
    if (selection.kind === 'lines') return {type:'merge-lines',lineIds:ids};
    if (selection.kind === 'words') return {type:'merge-words',wordIds:ids};
    if (selection.kind === 'ruby') return {type:'merge-ruby',rubyIds:ids};
  }
  const direction = action === 'previous' ? -1 : 1;
  if (selection.kind === 'lines') {
    if (action !== 'previous' && action !== 'next') throw new Error('此操作不适用于歌词行');
    const picked=document.lines.filter(line=>ids.includes(line.id));
    if(picked.length!==ids.length)throw new Error('选区包含失效行');
    if(picked[0].backgroundOf) {
      if(picked.some(line=>line.backgroundOf!==picked[0].backgroundOf))throw new Error('背景成组移动须属于同一主行');
      const ordered=moveGroup(document.lines.filter(line=>line.backgroundOf===picked[0].backgroundOf),ids,direction);
      let cursor=0;
      return {type:'replace-document',document:{...document,lines:document.lines.map(line=>line.backgroundOf===picked[0].backgroundOf?ordered[cursor++]:line)}};
    }
    if(picked.some(line=>line.backgroundOf))throw new Error('主行和背景不能混选移动');
    const main = document.lines.filter(line=>!line.backgroundOf);
    const ordered = moveGroup(main,ids,direction);
    return {type:'replace-document',document:{...document,lines:ordered.flatMap(line=>[line,...document.lines.filter(bg=>bg.backgroundOf===line.id)])}};
  }
  if (selection.kind === 'words' || selection.kind === 'ruby') {
    const selected=document.lines.flatMap(line=>line.words.flatMap<{line:LyricLine;word:LyricWord;unit:RubyUnit|undefined}>(word=>selection.kind==='words' ? ids.includes(word.id)?[{line,word,unit:undefined}]:[] : word.rubyUnits.filter(unit=>ids.includes(unit.id)).map(unit=>({line,word,unit}))));
    if(selected.length!==ids.length)throw new Error('选区包含失效对象');
    if(action==='beat') {
      if(selected.some(({word,unit})=>!unit&&word.rubyUnits.length))throw new Error('有注音的正文请操作具体读音');
      if(selected.some(({word,unit})=>emptyBeatCount(editing,unit?.id??word.id)>=32))throw new Error('所选对象中有空拍已达 32 的对象');
      return {type:'batch',commands:selected.map(({word,unit})=>({type:'set-empty-beat',kind:unit?'ruby':'word',id:unit?.id??word.id,count:emptyBeatCount(editing,unit?.id??word.id)+1}))};
    }
    if(action==='redistribute') {
      const parents=selected.filter((item,i)=>selected.findIndex(other=>other.word.id===item.word.id)===i);
      if(parents.some(({word})=>!word.rubyUnits.length))throw new Error('所选词中存在无注音的词');
      return {type:'batch',commands:parents.map(({line,word})=>({type:'redistribute-ruby-time',lineId:line.id,wordId:word.id}))};
    }
    if(action==='mora'&&selection.kind==='ruby') {
      if(selected.some(({unit})=>!isKanaReading(unit!.reading)))throw new Error('按音拍拆分仅适用于纯假名，所选读音包含非假名单元');
      if(selected.some(({unit})=>splitReadingMora(unit!.reading).length<2))throw new Error('所选读音中有无法继续按音拍拆分的对象');
      const parents=selected.filter((item,i)=>selected.findIndex(other=>other.word.id===item.word.id)===i);
      return {type:'batch',commands:parents.map(({line,word})=>({type:'set-ruby-units',lineId:line.id,wordId:word.id,overwrite:true,units:word.rubyUnits.flatMap(unit=>ids.includes(unit.id)?distributeRubyTime({...word,beginMs:unit.beginMs,endMs:unit.endMs},splitReadingMora(unit.reading).map((reading,i)=>({...unit,id:i?crypto.randomUUID():unit.id,reading}))):[unit])}))};
    }
    if(action!=='previous'&&action!=='next')throw new Error('此操作不适用于选区');
    const {line,word}=selected[0];
    if(selected.some(item=>item.line!==line || selection.kind==='ruby'&&item.word!==word))throw new Error('成组移动不能跨父级');
    const lines=document.lines.map(item=>item!==line?item:{...line,words:selection.kind==='words'?moveGroup(line.words,ids,direction):line.words.map(item=>item!==word?item:{...word,rubyUnits:moveGroup(word.rubyUnits,ids,direction)})});
    return {type:'replace-document',document:{...document,lines}};
  }
  const {track,content,contents}=attachmentSelection(document,selection);
  let next: RomanizationContent[];
  if(selection.kind==='romanization-content') {
    const siblings=track.contents.filter(item=>item.lineId===content.lineId);
    let ordered: RomanizationContent[];
    if(action==='merge') {
      const selected=consecutive(siblings,ids), first=selected[0];
      if(selected.some(item=>item.kind!==first.kind))throw new Error('普通文本与定时内容不能混选合并');
      const merged: RomanizationContent=first.kind==='plain'?{...first,text:selected.map(item=>item.kind==='plain'?item.text:'').join('')}:{...first,units:selected.flatMap(item=>item.kind==='timed'?item.units:[])};
      ordered=siblings.flatMap(item=>item.id===first.id?[merged]:ids.includes(item.id)?[]:[item]);
    } else if(action==='tokenize') {
      if(contents.some(item=>item.kind!=='plain'))throw new Error('只处理纯文本内容，不重拆已有定时内容');
      ordered=siblings.map(item=>ids.includes(item.id)&&item.kind==='plain'?{...item,kind:'timed',units:(item.text.match(/\S+\s*|\s+/gu)??[]).map(text=>({id:crypto.randomUUID(),text,beginMs:null,endMs:null}))}:item);
    } else if(action==='previous'||action==='next') ordered=moveGroup(siblings,ids,direction);
    else throw new Error('此操作不适用于附属内容');
    let inserted=false;
    next=track.contents.flatMap(item=>item.lineId!==content.lineId?[item]:inserted?[]:(inserted=true,ordered));
  } else {
    if(content.kind!=='timed')throw new Error('请选择定时内容');
    let units;
    if(action==='merge') {
      const selected=consecutive(content.units,ids), first=selected[0];
      const merged={...first,text:selected.map(unit=>unit.text).join(''),...timeEnvelope(selected)};
      if(merged.beginMs!==null&&merged.endMs!==null&&merged.beginMs>merged.endMs)throw new Error('合并时间开始晚于结束');
      units=content.units.flatMap(unit=>unit.id===first.id?[merged]:ids.includes(unit.id)?[]:[unit]);
    } else if(action==='split') {
      if(ids.length!==1)throw new Error('拆分单元需要明确单个切点，请先单选');
      const unit=content.units.find(unit=>unit.id===ids[0])!;
      const [left,right]=splitAtGrapheme(unit.text,Math.floor(Array.from(unit.text).length/2));
      const middle=unit.beginMs===null||unit.endMs===null?null:unit.beginMs+Math.round((unit.endMs-unit.beginMs)*Array.from(left).length/Array.from(unit.text).length);
      units=content.units.flatMap(item=>item!==unit?[item]:[{...unit,text:left,endMs:middle},{...unit,id:crypto.randomUUID(),text:right,beginMs:middle}]);
    } else if(action==='previous'||action==='next') units=moveGroup(content.units,ids,direction);
    else throw new Error('此操作不适用于附属单元');
    next=track.contents.map(item=>item===content?{...content,units}:item);
  }
  const key=selection.attachment==='translation'?'translationTracks':'romanizationTracks';
  return {type:'replace-document',document:{...document,[key]:document[key].map(item=>item.id===track.id?{...item,contents:next}:item)}};
}
