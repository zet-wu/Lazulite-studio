import { lineText, type LyricDocument, type LyricLine, type LyricWord } from './lyric-document';
export const amllLabels = {
  simplified: '使用 AMLL 简化歌手模型', noMultipleBackgrounds: '禁用多行背景', noChorus: '禁用多歌手合唱', noWordAgents: '禁用词级歌手', noIndependentBackground: '禁用背景独立歌手',
} as const;
export type AmllRule = keyof typeof amllLabels;
export type AmllSettings = Record<AmllRule, boolean>;
export const createAmllSettings = (): AmllSettings => ({ simplified: false, noMultipleBackgrounds: true, noChorus: false, noWordAgents: true, noIndependentBackground: false });
export const amllDependencies: AmllRule[] = ['noChorus', 'noWordAgents', 'noIndependentBackground'];
export const sameAgents = (a: string[], b: string[]) => a.length === b.length && a.every(id => b.includes(id));
export const lineAgents = (doc: LyricDocument, line: LyricLine): string[] => line.agentRefs.length ? line.agentRefs : line.backgroundOf ? doc.lines.find(item => item.id === line.backgroundOf)!.agentRefs : [];
export const wordAgents = (doc: LyricDocument, line: LyricLine, word: LyricWord) => word.agentRefs ?? lineAgents(doc, line);
export type AmllIssue = { id: string; lineId?: string; wordId?: string; agentId?: string; message: string };
export type AmllResults = Record<AmllRule, AmllIssue[]>;
export function checkAmll(doc: LyricDocument): AmllResults {
  const result: AmllResults = { simplified: [], noMultipleBackgrounds: [], noChorus: [], noWordAgents: [], noIndependentBackground: [] };
  for (const agent of doc.agents) if (!['v1','v2'].includes(agent.id) || agent.type !== 'person' || agent.name !== null || agent.actorRef) result.simplified.push({id:agent.id,agentId:agent.id,message:'自定义歌手不符合简化歌手模型'});
  const backgrounds = new Map<string, LyricLine[]>();
  for (const line of doc.lines) {
    const base = { id:line.id, lineId:line.id, message:lineText(line) };
    if (line.backgroundOf) { const group=backgrounds.get(line.backgroundOf)??[]; group.push(line);backgrounds.set(line.backgroundOf,group); }
    if (line.agentRefs.length>1) result.noChorus.push(base);
    const parent = line.backgroundOf ? doc.lines.find(item=>item.id===line.backgroundOf) : null;
    if (parent && (!sameAgents(lineAgents(doc,line),parent.agentRefs) || line.words.some(word=>!sameAgents(wordAgents(doc,line,word),parent.agentRefs)))) result.noIndependentBackground.push(base);
    for (const word of line.words) {
      const item = {id:word.id,lineId:line.id,wordId:word.id,message:word.text};
      if (word.agentRefs?.length) result.noWordAgents.push(item);
      if ((word.agentRefs?.length??0)>1) result.noChorus.push(item);
    }
  }
  for (const [id,group] of backgrounds) if(group.length>1) result.noMultipleBackgrounds.push({id,lineId:id,message:`${group.length} 条背景，${group.length-1} 条多余背景`});
  return result;
}
export function ruleCount(result: AmllResults, rule: AmllRule) { return result[rule].length + (rule==='simplified' ? amllDependencies.reduce((n,key)=>n+result[key].length,0) : 0); }
export function validateAmllSettings(settings: AmllSettings) {
  if (!settings || Object.keys(settings).length!==5 || Object.keys(amllLabels).some(key=>typeof settings[key as AmllRule]!=='boolean')) throw new Error('AMLL 项目设置无效');
  if (settings.simplified && amllDependencies.some(key=>!settings[key])) throw new Error('简化模型依赖限制必须开启');
}
export function assertAmll(doc: LyricDocument, settings: AmllSettings) {
  validateAmllSettings(settings);
  const results=checkAmll(doc);
  for (const key of Object.keys(amllLabels) as AmllRule[]) if(settings[key] && ruleCount(results,key)) throw new Error(`${amllLabels[key]}：当前内容不满足，请到 AMLL 兼容校验定位处理`);
}
export function validateAgents(doc: LyricDocument) {
  const ids=new Set(doc.agents.map(agent=>agent.id));
  if(ids.size!==doc.agents.length)throw new Error('歌手标识重复');
  for(const line of doc.lines) for(const refs of [line.agentRefs,...line.words.map(word=>word.agentRefs)]) if(refs!==undefined && (!Array.isArray(refs)||new Set(refs).size!==refs.length||refs.some(id=>!ids.has(id)))) throw new Error('歌手引用无效或重复');
  for(const line of doc.lines) for(const word of line.words) if(word.agentRefs && !word.agentRefs.length) throw new Error('词级歌手清除时必须移除字段');
}
export function preserveWordAgents(doc: LyricDocument, from: LyricLine, to: LyricLine, word: LyricWord): LyricWord {
  if (word.agentRefs) return word;
  const effective=wordAgents(doc,from,word);
  if(sameAgents(effective,lineAgents(doc,to))) return word;
  if(!effective.length) throw new Error('无歌手词无法在有歌手目标行中保真，请先统一歌手');
  return {...word,agentRefs:[...effective]};
}
export function displayLines(doc: LyricDocument, order: string[]) {
  const byId=new Map(doc.lines.map(line=>[line.id,line]));
  const included=new Set(order);
  return [...order.flatMap(id=>byId.has(id)?[byId.get(id)!]:[]),...doc.lines.filter(line=>!included.has(line.id))];
}
export function groupDisplayLines(doc: LyricDocument, before: string[]) {
  return doc.lines.filter(line=>!line.backgroundOf).flatMap(line=>{
    const bg=doc.lines.filter(item=>item.backgroundOf===line.id);
    return [...bg.filter(item=>before.includes(item.id)),line,...bg.filter(item=>!before.includes(item.id))];
  });
}
