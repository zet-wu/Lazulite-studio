import { wordAgents } from './amll-compatibility';
import type { LyricDocument, LyricLine, LyricWord } from './lyric-document';

export type SingerMarker = {
  agentIds: string[];
  trigger: string;
  beforeImage: string;
  afterImage: string;
  sizeMode: 'Zoom' | 'Fix';
  zoom: string;
  noDecor: boolean;
  forceWipeDecor: boolean;
  marginLeft: number;
  marginRight: number;
  marginBottom: number;
};
// Binding is independent of both display names and the project agent ordering.
export const singerKey = (ids: string[]) => JSON.stringify([...ids].sort());
export function singerSet(lyrics: LyricDocument, line: LyricLine, word: LyricWord) {
  const refs = wordAgents(lyrics, line, word);
  const ids = lyrics.agents.filter(agent => refs.includes(agent.id)).map(agent => agent.id);
  return { ids, key: singerKey(ids), label: ids.map(id => { const a = lyrics.agents.find(a => a.id === id)!; return a.name || a.id; }).join('+'), missing: refs.some(id => !ids.includes(id)) };
}
export function usedSingerSets(lyrics: LyricDocument) {
  return [...new Map(lyrics.lines.flatMap(line => line.words.filter(word=>word.text.trim()).map(word=>singerSet(lyrics,line,word))).filter(set=>set.ids.length&&!set.missing).map(set=>[set.key,set])).values()];
}
export const defaultSingerMarker = (set: ReturnType<typeof singerSet>): SingerMarker => ({ agentIds: set.ids, trigger: `【${set.label}】`, beforeImage: 'transparent-1x1.png', afterImage: '', sizeMode: 'Zoom', zoom: '1', noDecor: true, forceWipeDecor: false, marginLeft: 0, marginRight: -170, marginBottom: 0 });
export function initializeSingerMarkers(lyrics: LyricDocument, markers: SingerMarker[]): SingerMarker[] {
  const known = new Set(markers.map(marker=>singerKey(marker.agentIds)));
  return [...markers, ...usedSingerSets(lyrics).filter(set=>!known.has(set.key)).map(defaultSingerMarker)];
}
export function markerProblem(marker: SingerMarker): string | null {
  if (!marker.trigger.length) return '触发标记不能为空';
  if (!marker.beforeImage.trim()) return '扫色前图片不能为空';
  if (marker.sizeMode==='Zoom' && (!/^(?:\d+(?:\.\d+)?|\.\d+)%?$/.test(marker.zoom) || Number(marker.zoom.replace('%',''))<=0 || !Number.isFinite(Number(marker.zoom.replace('%',''))))) return 'Zoom 须为正数，可带百分号';
  if ([marker.marginLeft,marker.marginRight,marker.marginBottom].some(value=>!Number.isSafeInteger(value))) return '边距须为整数像素';
  return null;
}
export function validateSingerMarkers(markers: SingerMarker[]) {
  if (!Array.isArray(markers)) throw new Error('歌手标记数据无效');
  const keys = new Set<string>();
  for (const marker of markers) {
    if (!marker || !Array.isArray(marker.agentIds) || !marker.agentIds.length || marker.agentIds.some(id=>typeof id!=='string'||!id) || new Set(marker.agentIds).size!==marker.agentIds.length || ['trigger','beforeImage','afterImage','zoom'].some(key=>typeof marker[key as keyof SingerMarker]!=='string') || !['Zoom','Fix'].includes(marker.sizeMode) || typeof marker.noDecor!=='boolean' || typeof marker.forceWipeDecor!=='boolean' || [marker.marginLeft,marker.marginRight,marker.marginBottom].some(value=>!Number.isSafeInteger(value))) throw new Error('歌手标记数据无效');
    const key=singerKey(marker.agentIds);if(keys.has(key))throw new Error('歌手标记集合重复');keys.add(key);
  }
}
