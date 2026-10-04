import { translationText } from './lyric-document';
import type { LyricLine as AmllLine } from '@applemusic-like-lyrics/core';
import { lineText, type LyricDocument, type LyricLine, type RomanizationContent } from './lyric-document';

export type PreviewLine = { id: string; lyric: AmllLine };
const milliseconds = (value: number) => value;
const valid = (begin: number | null, end: number | null): begin is number => begin !== null && end !== null && end > begin;

function previewRomanization(line: LyricLine, content: RomanizationContent | undefined): { text: string; words: Map<string, string> } {
  const words = new Map<string, string>();
  if (!content) return { text: '', words };
  if (content.kind === 'plain') return { text: content.text, words };
  const text = content.units.map((unit) => unit.text).join('');
  if (!content.units.length) return { text, words };
  for (const unit of content.units) {
    if (!valid(unit.beginMs, unit.endMs)) return { text, words: new Map() };
    const matches = line.words.filter((word) => valid(word.beginMs, word.endMs)
      && Math.min(word.endMs!, unit.endMs!) > Math.max(word.beginMs!, unit.beginMs!));
    if (matches.length !== 1) return { text, words: new Map() };
    words.set(matches[0].id, (words.get(matches[0].id) ?? '') + unit.text);
  }
  return { text, words };
}

/** Pure whitespace uses AMLL’s independent 0–0 text nodes; all timings remain a preview projection. */
export function toAmllLines(document: LyricDocument, showTranslation: boolean, showRomanization: boolean, trackId?: string | null): PreviewLine[] {
  const leadAgent = document.agents.find((agent) => document.lines.some((line) => line.agentRefs.includes(agent.id)))?.id;
  return document.lines.flatMap((line) => {
    const timedWords = line.words.filter((word) => valid(word.beginMs, word.endMs));
    const begin = line.beginMs ?? timedWords[0]?.beginMs ?? null;
    const end = line.endMs ?? timedWords.at(-1)?.endMs ?? null;
    if (!valid(begin, end)) return [];
    const contents = document.romanizationTracks.filter((track) => !trackId || track.id === trackId)
      .flatMap((track) => track.contents.filter((content) => content.lineId === line.id));
    const roman = showRomanization ? previewRomanization(line, contents[0]) : { text: '', words: new Map<string, string>() };
    const words: AmllLine['words'] = timedWords.length ? line.words.filter((word) => valid(word.beginMs, word.endMs) || /^\s+$/u.test(word.text)).map((word) => ({
      word: word.text,
      startTime: /^\s+$/u.test(word.text) ? 0 : milliseconds(word.beginMs!), endTime: /^\s+$/u.test(word.text) ? 0 : milliseconds(word.endMs!),
      romanWord: roman.words.get(word.id) || undefined, obscene: word.obscene,
      ruby: word.rubyUnits.filter((unit) => valid(unit.beginMs, unit.endMs)).map((unit) => ({ word: unit.reading, startTime: milliseconds(unit.beginMs!), endTime: milliseconds(unit.endMs!) })),
    })) : [{ word: lineText(line), startTime: milliseconds(begin), endTime: milliseconds(end!) }];
    return [{ id: line.id, lyric: {
      words, startTime: milliseconds(begin), endTime: milliseconds(end!),
      translatedLyric: showTranslation ? line.translations.map(translationText).join(' / ') : '',
      romanLyric: roman.words.size ? '' : roman.text,
      isBG: Boolean(line.backgroundOf), isDuet: Boolean(leadAgent && line.agentRefs.length && !line.agentRefs.includes(leadAgent)),
    } }];
  });
}
