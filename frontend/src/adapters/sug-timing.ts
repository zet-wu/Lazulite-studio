import type {TimeMs} from '../domain/lyric-document';
export type SugCharacter={text:string;checkCount:number;timestamps:number[];release:TimeMs;stop:boolean;linked:boolean;singerId:string;parts:string[]};
export type TextMeasurement={advance:number;ink:number};
export type MeasureSugText=(text:string)=>TextMeasurement;
export type SugCharacterTiming={beginMs:TimeMs;endMs:TimeMs;rubyEnd:TimeMs};
const graphemes=new Intl.Segmenter(undefined,{granularity:'grapheme'});
/** Browser font metrics, measured once at import. Whitespace has no ink weight. */
export function measureSugText():MeasureSugText{
 const canvas=document.createElement('canvas'),context=canvas.getContext('2d');
 if(!context)throw new Error('Canvas text measurement is unavailable');
 context.font=`32px ${getComputedStyle(document.body).fontFamily}`;
 return text=>Array.from(graphemes.segment(text),({segment})=>{
  const metrics=context.measureText(segment);
  return {advance:metrics.width,ink:/^\s+$/u.test(segment)?0:metrics.actualBoundingBoxLeft+metrics.actualBoundingBoxRight};
 }).reduce((sum,value)=>({advance:sum.advance+value.advance,ink:sum.ink+value.ink}),{advance:0,ink:0});
}
function atFraction(fraction:number,times:TimeMs[],weights:number[]):TimeMs{
 if(fraction<=0)return times[0];if(fraction>=1)return times.at(-1)!;
 const sum=weights.reduce((a,b)=>a+b,0);let before=0;
 for(let i=0;i<weights.length;i++){
  const after=before+weights[i]/sum;
  if(fraction<=after&&after>before){const begin=times[i],end=times[i+1];return begin===null||end===null?null:Math.floor(begin+(end-begin)*(fraction-before)/(after-before));}
  before=after;
 }
 return times.at(-1)!;
}
/** Preview-style windows between starts, split by explicit singing stops and missing checkpoints. */
export function allocateSugTimes(chars:SugCharacter[],left:TimeMs,right:TimeMs,measure:MeasureSugText):SugCharacterTiming[]{
 const result:SugCharacterTiming[]=chars.map(char=>({beginMs:char.timestamps[0]??null,endMs:char.stop?char.release:null,rubyEnd:null}));
 let segmentStart=0,previous=left;
 while(segmentStart<chars.length){
  let segmentEnd=segmentStart;while(segmentEnd<chars.length-1&&!chars[segmentEnd].stop)segmentEnd++;
  const leaders=chars.flatMap((char,index)=>index>=segmentStart&&index<=segmentEnd&&char.checkCount>0?[index]:[]);
  const starts=leaders[0]===segmentStart?leaders:[segmentStart,...leaders];
  for(const [position,start] of starts.entries()){
   const next=starts[position+1],end=next===undefined?segmentEnd:next-1,leader=chars[start];
   const begin=leader.timestamps[0]??(leader.checkCount===0?previous:null);
   const candidate=next!==undefined?(chars[next].timestamps[0]??null):chars[segmentEnd].stop?chars[segmentEnd].release:right;
   const boundary=candidate!==null&&begin!==null&&candidate<begin?null:candidate;
   const group=chars.slice(start,end+1),metrics=group.map(char=>measure(char.text));
   const multipleAnchors=leader.timestamps.length>=2&&end>start;
   let weights=metrics.map(value=>multipleAnchors?value.ink:value.ink>0?value.advance:0);if(!weights.some(value=>value>0))weights=metrics.map(value=>value.advance);
   if(!weights.some(value=>value>0))weights=group.map(()=>1);
   const sum=weights.reduce((a,b)=>a+b,0);let cumulative=0;
   const checkpoints=leader.checkCount>0?Array.from({length:leader.checkCount},(_,i)=>leader.timestamps[i]??null):[begin];
   const times=[...checkpoints,boundary];
   const partWeights=leader.parts.length===checkpoints.length?leader.parts.map(part=>part==='^pause^'||!part?0:measure(part).advance):[];
   const progress=partWeights.some(value=>value>0)?partWeights:checkpoints.map(()=>1);
   for(let i=start;i<=end;i++){
    const a=cumulative/sum;cumulative+=weights[i-start];const b=cumulative/sum;
    // Multiple starts affect body distribution when the leader owns following zero-checkpoint characters.
    const bodyTimes=leader.checkCount>0&&!leader.timestamps.length?[null,chars[end].stop?chars[end].release:null]:checkpoints.length>1&&end>start?times:[begin,boundary];
    const bodyWeights=bodyTimes.length>2?progress:[1];
    result[i]={beginMs:atFraction(a,bodyTimes,bodyWeights),endMs:atFraction(b,bodyTimes,bodyWeights),rubyEnd:i===start?boundary:atFraction(b,bodyTimes,bodyWeights)};
   }
   // Recorded ordinary starts and releases remain authoritative, including overlaps with the next segment.
   if(leader.timestamps.length)result[start].beginMs=leader.timestamps[0];
   if(chars[end].stop)result[end].endMs=chars[end].release;
  }
  previous=chars[segmentEnd].stop?chars[segmentEnd].release:result[segmentEnd].endMs;
  segmentStart=segmentEnd+1;
 }
 return result;
}
export function sugRubyUnits(char:SugCharacter,timing:SugCharacterTiming,measure:MeasureSugText){
 if(!char.parts.length)return [];
 const count=char.checkCount||1;
 const anchors=[...Array.from({length:count},(_,i)=>char.checkCount?char.timestamps[i]??null:timing.beginMs),timing.rubyEnd];
 const weights=char.parts.map(part=>part==='^pause^'||!part?measure('一').advance:measure(part).advance);
 const sum=weights.reduce((a,b)=>a+b,0)||weights.length;
 let cumulative=0;
 return char.parts.flatMap((reading,index)=>{
  const begin=char.parts.length===count?anchors[index]:atFraction(cumulative/sum,anchors,Array.from({length:count},()=>1));
  cumulative+=weights[index]||(!sum?1:0);
  const end=char.parts.length===count?anchors[index+1]:atFraction(cumulative/sum,anchors,Array.from({length:count},()=>1));
  return reading&&reading!=='^pause^'?[{id:crypto.randomUUID(),reading,beginMs:begin,endMs:end}]:[];
 });
}
