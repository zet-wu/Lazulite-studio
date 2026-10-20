import { lineText, type LyricDocument, type LyricWord, type RubyUnit } from './lyric-document';
import { planWordMerge, type LyricCommand } from './lyric-commands';

export type DictionaryRange = {
  lineId: string; start: number; end: number; base: string;
  status: 'known' | 'unknown' | 'ambiguous' | 'boundary' | 'unannotated'; units: string[];
};
export type DictionaryBlock = Readonly<{
  key: string; start: number; end: number; base: string; existing: boolean;
  status: DictionaryRange['status']; spans: readonly { wordId: string; start: number; end: number }[];
  original: readonly string[]; merge: boolean;
}> & { units: string[]; skip: boolean };
export type DictionaryRow = { lineId: string; blocks: DictionaryBlock[] };

export function proposeDictionaryRuby(source: LyricDocument, ids: string[], ranges: DictionaryRange[]): DictionaryRow[] {
  return source.lines.filter(l => ids.includes(l.id)).map(line => {
    const text = lineText(line);
    let offset = 0;
    const words = line.words.map(word => { const start = offset; offset += word.text.length; return {word, start, end: offset}; });
    const entries = ranges.filter(r => r.lineId === line.id);
    let end = 0;
    for (const r of entries) {
      if (r.start !== end || r.end <= r.start || r.end > text.length || text.slice(r.start,r.end) !== r.base) throw new Error('词典范围与正文快照不符');
      end = r.end;
    }
    if (end !== text.length) throw new Error('词典结果未覆盖整行正文');
    const selected: Array<DictionaryRange & { existing: boolean }> = [];
    for (const r of entries) {
      if (words.some(w => w.word.rubyUnits.length && w.start < r.end && w.end > r.start)) continue;
      selected.push({...r, existing:false});
    }
    for (const w of words) if (w.word.rubyUnits.length) {
      selected.push({lineId:line.id,start:w.start,end:w.end,base:w.word.text,status:'known',units:w.word.rubyUnits.map(u=>u.reading),existing:true});
    }
    selected.sort((a,b)=>a.start-b.start);
    const covered: typeof selected = [];
    let cursor = 0;
    for (const r of selected) {
      if (r.start > cursor) covered.push({lineId:line.id,start:cursor,end:r.start,base:text.slice(cursor,r.start),status:'unknown',units:[],existing:false});
      covered.push(r); cursor=r.end;
    }
    if(cursor<text.length)covered.push({lineId:line.id,start:cursor,end:text.length,base:text.slice(cursor),status:'unknown',units:[],existing:false});
    return {lineId:line.id, blocks:covered.map(r=>{
      const spans=words.filter(w=>w.start<r.end&&w.end>r.start).map(w=>({wordId:w.word.id,start:Math.max(r.start,w.start)-w.start,end:Math.min(r.end,w.end)-w.start}));
      const units=r.units.length?[...r.units]:[''];
      return {...r,key:`${line.id}:${r.start}:${r.end}`,original:[...units],units,spans,merge:spans.length>1,skip:false};
    })};
  });
}

export function dictionaryBlockApplies(block: DictionaryBlock, merge: boolean) {
  return !block.skip && (!block.merge || merge) && block.status !== 'boundary' && block.status !== 'unannotated'
    && block.units.every(u=>u.trim()) && (!block.existing || block.units.some((u,i)=>u!==block.original[i]));
}

const makeUnits = (word: LyricWord, readings: string[]): RubyUnit[] => {
  const at=(i:number)=>i===0?word.beginMs:i===readings.length?word.endMs:word.beginMs===null||word.endMs===null?null:word.beginMs+Math.round((word.endMs-word.beginMs)*i/readings.length);
  return readings.map((reading,i)=>({id:crypto.randomUUID(),reading,beginMs:at(i),endMs:at(i+1)}));
};

export function dictionaryRubyCommand(current: LyricDocument, source: LyricDocument, rows: DictionaryRow[], merge: boolean): LyricCommand {
  if(current!==source)throw new Error('源文档已变化，请重新打开生成');
  if(!rows.some(row=>row.blocks.some(b=>dictionaryBlockApplies(b,merge))))throw new Error('没有可应用的注音修改');
  const mapped=new Map(rows.map(row=>[row.lineId,row]));
  const lines=source.lines.map(line=>{
    const row=mapped.get(line.id); if(!row)return line;
    const accepted=row.blocks.filter(b=>dictionaryBlockApplies(b,merge));
    const mergeParts=new Map<DictionaryBlock,string[]>();
    let words=line.words.flatMap(word=>{
      const blocks=accepted.filter(b=>b.spans.some(s=>s.wordId===word.id));
      if(!blocks.length)return [word];
      if(word.rubyUnits.length) {
        const block=blocks[0];
        return [{...word,rubyUnits:word.rubyUnits.map((u,i)=>({...u,reading:block.units[i]}))}];
      }
      const ranges=blocks.map(b=>({block:b,span:b.spans.find(s=>s.wordId===word.id)!})).sort((a,b)=>a.span.start-b.span.start);
      // Consecutive fine segments inside an existing word retain that word.
      const groups: Array<{start:number;end:number;blocks:DictionaryBlock[]}>=[];
      for(const {block,span} of ranges) {
        const last=groups.at(-1);
        if(last&&last.end===span.start&&!block.merge&&!last.blocks.some(b=>b.merge)){last.end=span.end;last.blocks.push(block);}
        else groups.push({start:span.start,end:span.end,blocks:[block]});
      }
      const cuts=[...new Set([0,word.text.length,...groups.flatMap(g=>[g.start,g.end])])].sort((a,b)=>a-b);
      const boundary=(at:number)=>at===0?word.beginMs:at===word.text.length?word.endMs:word.beginMs===null||word.endMs===null?null:word.beginMs+Math.round((word.endMs-word.beginMs)*Array.from(word.text.slice(0,at)).length/Array.from(word.text).length);
      return cuts.slice(0,-1).map((a,i)=>{
        const b=cuts[i+1], group=groups.find(g=>g.start===a&&g.end===b);
        const part={...word,id:i?crypto.randomUUID():word.id,text:word.text.slice(a,b),beginMs:boundary(a),endMs:boundary(b)};
        if(!group)return part;
        if(group.blocks[0].merge) {
          const block=group.blocks[0], ids=mergeParts.get(block)??[]; ids.push(part.id);mergeParts.set(block,ids);return part;
        }
        return {...part,rubyUnits:makeUnits(part,group.blocks.flatMap(block=>block.units))};
      });
    });
    for(const [block,ids] of mergeParts) {
      const interim={...source,lines:source.lines.map(l=>l===line?{...line,words}:l)};
      const {merged}=planWordMerge(interim,ids);
      const result={...merged,rubyUnits:makeUnits(merged,block.units)};
      words=words.flatMap(w=>w.id===ids[0]?[result]:ids.includes(w.id)?[]:[w]);
    }
    return {...line,words};
  });
  return {type:'replace-document',document:{...source,lines}};
}
