import type { LyricLine as AmllLine } from '@applemusic-like-lyrics/core';
import { lineText, type LyricDocument } from './lyric-document';

export type PreviewLine = { id: string; lyric: AmllLine };
const milliseconds = (value: number) => Math.round(value / 1000);
const valid = (begin: number | null, end: number | null): begin is number => begin !== null && end !== null && end > begin;

/** AMLL accepts only fully timed words. Untimed draft data stays in the document. */
export function toAmllLines(document: LyricDocument, showTranslation: boolean, showRomanization: boolean): PreviewLine[] {
  return document.lines.flatMap((line) => {
    const timedWords = line.words.filter((word) => valid(word.beginUs, word.endUs));
    const begin = line.beginUs ?? timedWords[0]?.beginUs ?? null;
    const end = line.endUs ?? timedWords.at(-1)?.endUs ?? null;
    if (!valid(begin, end)) return [];
    const words: AmllLine['words'] = timedWords.length ? timedWords.map((word) => ({
      word: word.text,
      startTime: milliseconds(word.beginUs!), endTime: milliseconds(word.endUs!),
      romanWord: word.romanization || undefined, obscene: word.obscene,
      ruby: word.rubyUnits.filter((unit) => valid(unit.beginUs, unit.endUs)).map((unit) => ({ word: unit.reading, startTime: milliseconds(unit.beginUs!), endTime: milliseconds(unit.endUs!) })),
    })) : [{ word: lineText(line), startTime: milliseconds(begin), endTime: milliseconds(end!) }];
    return [{ id: line.id, lyric: {
      words, startTime: milliseconds(begin), endTime: milliseconds(end!),
      translatedLyric: showTranslation ? line.translations.map((item) => item.text).join(' / ') : '',
      romanLyric: showRomanization ? [...line.romanizations.map((item) => item.text), ...(line.timedRomanizations ?? []).map((track) => track.words.map((word) => word.text).join(''))].join(' / ') : '',
      isBG: Boolean(line.backgroundOf), isDuet: line.duet,
    } }];
  });
}
