import type { LyricLine as AmllLine } from '@applemusic-like-lyrics/core';
import { lineText, type LyricDocument, type LyricLine, type RomanizationContent } from './lyric-document';

export type PreviewLine = { id: string; lyric: AmllLine };
const milliseconds = (value: number) => Math.round(value / 1000);
const valid = (begin: number | null, end: number | null): begin is number => begin !== null && end !== null && end > begin;

function previewRomanization(line: LyricLine, content: RomanizationContent | undefined): { text: string; words: Map<string, string> } {
  const words = new Map<string, string>();
  if (!content) return { text: '', words };
  if (content.kind === 'plain') return { text: content.text, words };
  const text = content.units.map((unit) => unit.text).join('');
  if (!content.units.length) return { text, words };
  for (const unit of content.units) {
    if (!valid(unit.beginUs, unit.endUs)) return { text, words: new Map() };
    const matches = line.words.filter((word) => valid(word.beginUs, word.endUs)
      && Math.min(word.endUs!, unit.endUs!) > Math.max(word.beginUs!, unit.beginUs!));
    if (matches.length !== 1) return { text, words: new Map() };
    words.set(matches[0].id, (words.get(matches[0].id) ?? '') + unit.text);
  }
  return { text, words };
}

/** Pure whitespace uses AMLL’s independent 0–0 text nodes; all timings remain a preview projection. */
export function toAmllLines(document: LyricDocument, showTranslation: boolean, showRomanization: boolean, trackId?: string | null): PreviewLine[] {
  const leadAgent = document.agents.find((agent) => document.lines.some((line) => !line.backgroundOf && line.agentRefs.includes(agent.id)))?.id;
  return document.lines.flatMap((line) => {
    const timedWords = line.words.filter((word) => valid(word.beginUs, word.endUs));
    const begin = line.beginUs ?? timedWords[0]?.beginUs ?? null;
    const end = line.endUs ?? timedWords.at(-1)?.endUs ?? null;
    if (!valid(begin, end)) return [];
    const contents = document.romanizationTracks.filter((track) => !trackId || track.id === trackId)
      .flatMap((track) => track.contents.filter((content) => content.lineId === line.id));
    const roman = showRomanization ? previewRomanization(line, contents[0]) : { text: '', words: new Map<string, string>() };
    const words: AmllLine['words'] = timedWords.length ? line.words.filter((word) => valid(word.beginUs, word.endUs) || /^\s+$/u.test(word.text)).map((word) => ({
      word: word.text,
      startTime: /^\s+$/u.test(word.text) ? 0 : milliseconds(word.beginUs!), endTime: /^\s+$/u.test(word.text) ? 0 : milliseconds(word.endUs!),
      romanWord: roman.words.get(word.id) || undefined, obscene: word.obscene,
      ruby: word.rubyUnits.filter((unit) => valid(unit.beginUs, unit.endUs)).map((unit) => ({ word: unit.reading, startTime: milliseconds(unit.beginUs!), endTime: milliseconds(unit.endUs!) })),
    })) : [{ word: lineText(line), startTime: milliseconds(begin), endTime: milliseconds(end!) }];
    const effective = line.backgroundOf ? document.lines.find((item) => item.id === line.backgroundOf) ?? line : line;
    return [{ id: line.id, lyric: {
      words, startTime: milliseconds(begin), endTime: milliseconds(end!),
      translatedLyric: showTranslation ? line.translations.map((item) => item.text).join(' / ') : '',
      romanLyric: roman.words.size ? '' : roman.text,
      isBG: Boolean(line.backgroundOf), isDuet: Boolean(leadAgent && effective.agentRefs.length && !effective.agentRefs.includes(leadAgent)),
    } }];
  });
}
