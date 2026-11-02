import { message, MessageError } from './messages';
import type { LyricDocument, TranslationTrack } from './lyric-document';
import { validateLanguageTag } from './sublyrics';

export function validateTranslationTracks(tracks: TranslationTrack[], lineIds: Set<string>): void {
  const ids = new Set<string>();
  const identity = (id: string) => { if (!id || ids.has(id)) throw new MessageError(message('translation.idInvalid')); ids.add(id); };
  for (const track of tracks) {
    identity(track.id); validateLanguageTag(track.language);
    if (!['subtitle', 'replacement'].includes(track.purpose)) throw new MessageError(message('translation.kindInvalid'));
    for (const content of track.contents) {
      identity(content.id);
      if (!lineIds.has(content.lineId)) throw new MessageError(message('translation.parentMissing'));
      if (content.kind === 'timed') for (const unit of content.units) {
        identity(unit.id);
        for (const time of [unit.beginMs, unit.endMs]) if (time !== null && (!Number.isSafeInteger(time) || time < 0)) throw new MessageError(message('translation.integerTime'));
        if (unit.beginMs !== null && unit.endMs !== null && unit.beginMs > unit.endMs) throw new MessageError(message('translation.reversed'));
      }
    }
  }
}
export function transferTranslations(document: LyricDocument, contentIds: string[], targetId: string): TranslationTrack[] {
  const selected = new Set(contentIds), target = document.translationTracks.find(track => track.id === targetId);
  if (!target) throw new MessageError(message('translation.targetMissing'));
  const all = document.translationTracks.flatMap(track => track.contents);
  if (all.filter(content => selected.has(content.id)).length !== selected.size) throw new MessageError(message('translation.selectionStale'));
  const moved = document.translationTracks.filter(track => track.id !== targetId).flatMap(track => track.contents.filter(content => selected.has(content.id)));
  if (!moved.length) return document.translationTracks;
  return document.translationTracks.flatMap(track => {
    if (track.id === targetId) return [{ ...track, contents: [...track.contents, ...moved] }];
    const contents = track.contents.filter(content => !selected.has(content.id));
    if (contents.length === track.contents.length) return [track];
    return contents.length ? [{ ...track, contents }] : [];
  });
}
