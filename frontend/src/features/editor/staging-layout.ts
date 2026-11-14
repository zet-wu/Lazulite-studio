import type {LyricDocument} from '../../domain/lyric-document';
import type {TimelineTarget} from '../../domain/timeline-editing';
import {projectTimeline} from '../../domain/timeline-projection';
import {documentTargets,targetId,targetInterval} from './selection-targets';
export type StagingItem={target:TimelineTarget;beginMissing:boolean;endMissing:boolean;assignable:boolean;text:string};
export type StagingSlot={item:StagingItem;left:number;width:number};
export type StagingRow={key:string;kind:TimelineTarget['kind'];width:number;slots:StagingSlot[]};
export function stagingItems(document:LyricDocument,durationMs:number|null,ignoredCharacters:string):StagingItem[]{
  const targets=documentTargets(document),projection=projectTimeline(document,durationMs),ignored=new Set([...ignoredCharacters]);
  const text=(target:TimelineTarget)=>{
    const value=targetInterval(document,target)!;
    return 'words'in value?value.words.map(word=>word.text).join(''):'reading'in value?value.reading:value.text;
  };
  const pending=new Set(targets.filter(target=>{
    const value=targetInterval(projection,target)!,content=text(target);
    return (value.beginMs===null||value.endMs===null)&&!(content.length>0&&[...content].every(char=>ignored.has(char)));
  }).map(targetId));
  const included=new Set(pending);
  for(const target of targets)if(pending.has(targetId(target))){included.add(target.lineId);if(target.kind==='ruby')included.add(target.wordId);}
  return targets.filter(target=>included.has(targetId(target))).map(target=>{
    const value=targetInterval(document,target)!;
    return {target,text:text(target),beginMissing:value.beginMs===null,endMissing:value.endMs===null,assignable:pending.has(targetId(target))};
  });
}
/** One coordinate space for words and their ruby; attachments keep their own content groups. */
export function stagingRows(items:StagingItem[],activeLine:string|null,visible:Record<TimelineTarget['kind'],boolean>):StagingRow[]{
  const rows:StagingRow[]=[];
  const flat=(key:string,kind:TimelineTarget['kind'],group:StagingItem[])=>{if(group.length)rows.push({key,kind,width:group.length*124-4,slots:group.map((item,i)=>({item,left:i*124,width:120}))});};
  if(!activeLine){if(visible.line)flat('lines','line',items.filter(item=>item.target.kind==='line'));return rows;}
  const children=items.filter(item=>item.target.lineId===activeLine);
  const words=children.filter(item=>item.target.kind==='word');
  const wordSlots:StagingSlot[]=[],rubySlots:StagingSlot[]=[];let left=0;
  for(const word of words){
    const rubies=visible.ruby?children.filter(item=>item.target.kind==='ruby'&&item.target.wordId===targetId(word.target)):[];
    const width=Math.max(120,rubies.length*124-4);
    if(visible.word)wordSlots.push({item:word,left,width});
    rubies.forEach((item,i)=>rubySlots.push({item,left:left+i*124,width:120}));
    left+=width+4;
  }
  if(wordSlots.length)rows.push({key:'words',kind:'word',width:left-4,slots:wordSlots});
  if(rubySlots.length)rows.push({key:'ruby',kind:'ruby',width:left-4,slots:rubySlots});
  if(visible.romanization){
    const groups=new Map<string,StagingItem[]>();
    for(const item of children)if(item.target.kind==='romanization'){
      const key=`${item.target.attachment??'romanization'}:${item.target.trackId}:${item.target.contentId}`;
      groups.set(key,[...groups.get(key)??[],item]);
    }
    for(const [key,group]of groups)flat(key,'romanization',group);
  }
  return rows;
}
