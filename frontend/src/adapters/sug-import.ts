import {message,MessageError} from '../domain/messages';
import {AGENT_TYPES,createLine,createWord,createLyricDocument,type LyricAgent,type LyricDocument,type LyricLine,type RomanizationTrack,type TimeMs,type TranslationTrack} from '../domain/lyric-document';
import {allocateSugTimes,measureSugText,sugRubyUnits,type MeasureSugText,type SugCharacter} from './sug-timing';
type RecordValue=Record<string,unknown>;
const invalid=():never=>{throw new MessageError(message('parse.sugInvalid'));};
const object=(value:unknown):RecordValue=>value&&typeof value==='object'&&!Array.isArray(value)?value as RecordValue:invalid();
const string=(value:unknown,fallback=''):string=>value===undefined?fallback:typeof value==='string'?value:invalid();
const integer=(value:unknown,fallback=0):number=>value===undefined?fallback:typeof value==='number'&&Number.isSafeInteger(value)?value:invalid();
const time=(value:unknown):TimeMs=>value===undefined||value===null?null:integer(value)>=0?integer(value):invalid();
const flag=(value:unknown):boolean=>value===undefined?false:typeof value==='boolean'?value:invalid();
const array=(value:unknown):unknown[]=>value===undefined?[]:Array.isArray(value)?value:invalid();
type Sentence={sourceId:string;singerId:string;chars:SugCharacter[];role:string;parent:string;language:string;agent:string;order:number;begin:TimeMs;end:TimeMs;songPart:string};
function boundary(sentences:Sentence[],index:number,direction:-1|1,duration:TimeMs):TimeMs{
 for(let i=index+direction;i>=0&&i<sentences.length;i+=direction){
  const chars=sentences[i].chars;
  if(chars.some(char=>char.checkCount>char.timestamps.length||char.stop&&char.release===null))return null;
  const stamps=chars.flatMap(char=>[...char.timestamps,...(char.stop&&char.release!==null?[char.release]:[])]);
  if(stamps.length)return direction===1?stamps[0]:Math.max(...stamps);
 }
 return direction===1?duration:null;
}
export function importSugFile(content:string,measure?:MeasureSugText):{document:LyricDocument;incompleteCheckpoints:number}{
 let data:RecordValue;
 try{data=object(JSON.parse(content.replace(/^\uFEFF/,'')));}catch(cause){if(cause instanceof MessageError)throw cause;invalid();}
 if(data!.version!=='0.3.0')throw new MessageError(message('parse.sugVersion'));
 const offset=integer(data!.global_offset_ms??0),duration=time(data!.audio_duration_ms);
 const shifted=(value:unknown):TimeMs=>{const raw=time(value);if(raw===null)return null;const sum=raw+offset;if(!Number.isSafeInteger(sum))invalid();return Math.max(0,sum);};
 const singers=array(data!.singers).map(object),agentMap=new Map<string,string>();
 const agents:LyricAgent[]=singers.map((singer,index)=>{
  const sourceId=string(singer.id);if(!sourceId||agentMap.has(sourceId))invalid();
  const id=`v${index+1}`;agentMap.set(sourceId,id);
  const sourceType=singer.ttml_agent_type??singer.type;const type=typeof sourceType==='string'?sourceType:'';
  return {id,name:string(singer.name)||null,type:AGENT_TYPES.some(value=>value===type)?type:'person'};
 });
 // Resolve only explicit, unambiguous source references. Names never imply membership or actors.
 const sourceAliases=new Map<string,string[]>();
 for(const singer of singers){const alias=string(singer.ttml_agent_id);if(alias)sourceAliases.set(alias,[...(sourceAliases.get(alias)??[]),agentMap.get(string(singer.id))!]);}
 singers.forEach((singer,index)=>{const ref=string(singer.actorRef??singer.actor_ref);const target=agentMap.get(ref)??(sourceAliases.get(ref)?.length===1?sourceAliases.get(ref)![0]:undefined);if(target&&target!==agents[index].id)agents[index].actorRef=target;});
 const reference=(value:unknown)=>{const id=string(value);if(id&&!agentMap.has(id))invalid();return id;};
 const sourceIds=new Set<string>();let incompleteCheckpoints=0,totalCharacters=0;
 const sentences=array(data!.sentences).map((value):Sentence=>{
  const row=object(value),sourceId=string(row.id);if(!sourceId||sourceIds.has(sourceId))invalid();sourceIds.add(sourceId);
  const chars=array(row.characters).map((value):SugCharacter=>{
   const char=object(value),text=string(char.char),checkCount=integer(char.check_count,1);
   if(checkCount<0||checkCount>1024)invalid();
   const timestamps=array(char.timestamps).map(value=>shifted(value)!);
   if(timestamps.some((value,index)=>value===null||index>0&&value<timestamps[index-1])||timestamps.length>checkCount)invalid();
   const stop=flag(char.is_sentence_end),release=shifted(char.sentence_end_ts);
   if(stop&&release!==null&&timestamps.length&&release<timestamps.at(-1)!)invalid();
   incompleteCheckpoints+=checkCount-timestamps.length+(stop&&release===null?1:0);
   const parts=char.ruby===undefined||char.ruby===null?[]:array(object(char.ruby).parts).map(value=>{const part=object(value);integer(part.offset_ms);return string(part.text);});
   // Source guide characters remain ordinary text; the guide intent is not imported.
   return {text,checkCount,timestamps,stop,release,linked:flag(char.linked_to_next),singerId:reference(char.singer_id),parts};
  });
  totalCharacters+=chars.length;
  return {sourceId,singerId:reference(row.singer_id),chars,role:string(row.aux_role),parent:string(row.aux_parent_id),language:string(row.aux_lang),agent:string(row.aux_agent),order:integer(row.aux_order),begin:shifted(row.aux_begin),end:shifted(row.aux_end),songPart:string(row.song_part)};
 });
 if(!sentences.length||sentences.length>20000||totalCharacters>500000)invalid();
 const bySource=new Map(sentences.map(row=>[row.sourceId,row]));
 const relations=new Map<string,Sentence>();
 for(const row of sentences){
  const parent=bySource.get(row.parent);
  if(!parent||parent===row||!['x-bg','x-translation','x-roman'].includes(row.role))continue;
  // Backgrounds attach to main lyrics; translations and romanizations may also attach to backgrounds.
  const parentHasRelation=parent.parent&&bySource.has(parent.parent)&&['x-bg','x-translation','x-roman'].includes(parent.role);
  if(parentHasRelation&&(parent.role!=='x-bg'||row.role==='x-bg'||parent.parent===row.sourceId))continue;
  relations.set(row.sourceId,parent);
 }
 const sequenceKey=(row:Sentence)=>relations.has(row.sourceId)?JSON.stringify([row.role,row.language,row.agent||row.singerId]):'main';
 const sequences=new Map<string,Sentence[]>();for(const row of sentences){const key=sequenceKey(row);sequences.set(key,[...(sequences.get(key)??[]),row]);}
 const measureText=measure??measureSugText(),lines=new Map<string,LyricLine>();
 for(const row of sentences){
  const sequence=sequences.get(sequenceKey(row))!,index=sequence.indexOf(row);
  const allocation=allocateSugTimes(row.chars,boundary(sequence,index,-1,null),boundary(sequence,index,1,duration&&duration>0?duration:null),measureText);
  const line=createLine('');line.agentRefs=row.singerId?[agentMap.get(row.singerId)!]:[];line.songPart=row.songPart||null;
  const groups:{chars:SugCharacter[];indices:number[]}[]=[];
  row.chars.forEach((char,i)=>{
   const previous=row.chars[i-1];
   // A singer change needs a word boundary because Studio stores overrides on words.
   if(i>0&&previous.linked&&(previous.singerId||row.singerId)===(char.singerId||row.singerId)){groups.at(-1)!.chars.push(char);groups.at(-1)!.indices.push(i);}
   else groups.push({chars:[char],indices:[i]});
  });
  line.words=groups.map(group=>{
   const word=createWord(group.chars.map(char=>char.text).join(''));
   word.rubyUnits=group.indices.flatMap(i=>sugRubyUnits(row.chars[i],allocation[i],measureText));
   const intervals=[...group.indices.map(i=>allocation[i]),...word.rubyUnits];
   const envelope=(key:'beginMs'|'endMs'):TimeMs=>intervals.some(item=>item[key]===null)?null:intervals.length?(key==='beginMs'?Math.min:Math.max)(...intervals.map(item=>item[key]!)):null;
   word.beginMs=envelope('beginMs');word.endMs=envelope('endMs');
   const singerId=group.chars[0].singerId;if(singerId&&singerId!==row.singerId)word.agentRefs=[agentMap.get(singerId)!];
   return word;
  });
  const ends=(key:'beginMs'|'endMs'):TimeMs=>line.words.some(word=>word[key]===null)?null:line.words.length?(key==='beginMs'?Math.min:Math.max)(...line.words.map(word=>word[key]!)):null;
  line.beginMs=ends('beginMs');line.endMs=ends('endMs');lines.set(row.sourceId,line);
 }
 const document=createLyricDocument();document.lines=[];document.agents=agents;
 const translations=new Map<string,TranslationTrack>(),romanizations=new Map<string,RomanizationTrack>();
 for(const row of sentences){
  const line=lines.get(row.sourceId)!,parent=relations.get(row.sourceId);
  if(parent&&(row.role==='x-translation'||row.role==='x-roman')){
   const key=JSON.stringify([row.language,row.agent||row.singerId]);
   const tracks=row.role==='x-translation'?translations:romanizations;
   let track=tracks.get(key);
   if(!track){track={id:crypto.randomUUID(),language:row.language||null,contents:[],...(row.role==='x-translation'?{purpose:'subtitle' as const}:{})};tracks.set(key,track as TranslationTrack);}
   const parentId=lines.get(parent.sourceId)!.id,text=row.chars.map(char=>char.text).join('');
   const timed=row.chars.some(char=>char.timestamps.length||char.stop&&char.release!==null);
   track.contents.push(timed?{id:crypto.randomUUID(),lineId:parentId,kind:'timed',units:line.words.map(word=>({id:crypto.randomUUID(),text:word.text,beginMs:word.beginMs,endMs:word.endMs}))}:row.begin!==null||row.end!==null?{id:crypto.randomUUID(),lineId:parentId,kind:'timed',units:[{id:crypto.randomUUID(),text,beginMs:row.begin,endMs:row.end}]}:{id:crypto.randomUUID(),lineId:parentId,kind:'plain',text});
  }else{
   if(parent&&row.role==='x-bg')line.backgroundOf=lines.get(parent.sourceId)!.id;
   document.lines.push(line);
  }
 }
 document.translationTracks=[...translations.values()];document.romanizationTracks=[...romanizations.values()];
 const metadata=data!.metadata===undefined?{}:object(data!.metadata),tags=data!.nicokara_tags===undefined?{}:object(data!.nicokara_tags);
 for(const key of ['title','artist','album','composer','lyricist','arranger','year']){const value=metadata[key]??tags[key];if(value!==undefined){const text=string(value);if(text.length)document.metadata[key]=[text];}}
 const extra=metadata.extra===undefined?{}:object(metadata.extra);
 for(const [key,value] of Object.entries(extra)){if(!document.metadata[key]&&typeof value==='string'&&value.length)document.metadata[key]=[value];}
 document.language=string(metadata.language)||null;
 return {document,incompleteCheckpoints};
}
