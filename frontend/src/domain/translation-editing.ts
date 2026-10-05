import type { LyricDocument, TranslationTrack } from './lyric-document';
import { validateLanguageTag } from './sublyrics';

export function validateTranslationTracks(tracks: TranslationTrack[], lineIds: Set<string>): void {
  const ids = new Set<string>();
  const identity = (id: string) => { if (!id || ids.has(id)) throw new Error('翻译标识为空或重复'); ids.add(id); };
  for (const track of tracks) {
    identity(track.id); validateLanguageTag(track.language);
    if (!['subtitle', 'replacement'].includes(track.purpose)) throw new Error('翻译类型无效');
    for (const content of track.contents) {
      identity(content.id);
      if (!lineIds.has(content.lineId)) throw new Error('翻译所属行不存在');
      if (content.kind === 'timed') for (const unit of content.units) {
        identity(unit.id);
        for (const time of [unit.beginMs, unit.endMs]) if (time !== null && (!Number.isSafeInteger(time) || time < 0)) throw new Error('翻译时间必须为非负整数毫秒');
        if (unit.beginMs !== null && unit.endMs !== null && unit.beginMs > unit.endMs) throw new Error('翻译开始不能晚于结束');
      }
    }
  }
}
export function transferTranslations(document: LyricDocument, contentIds: string[], targetId: string): TranslationTrack[] {
  const selected = new Set(contentIds), target = document.translationTracks.find(track => track.id === targetId);
  if (!target) throw new Error('目标翻译轨道不存在');
  const all = document.translationTracks.flatMap(track => track.contents);
  if (all.filter(content => selected.has(content.id)).length !== selected.size) throw new Error('所选翻译内容已失效');
  const moved = document.translationTracks.filter(track => track.id !== targetId).flatMap(track => track.contents.filter(content => selected.has(content.id)));
  if (!moved.length) return document.translationTracks;
  return document.translationTracks.map(track => ({ ...track, contents: track.id === targetId ? [...track.contents, ...moved] : track.contents.filter(content => !selected.has(content.id)) }));
}
