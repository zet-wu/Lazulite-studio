import { lineAgents } from './amll-compatibility';
import { translationsForLine } from './lyric-document';
import { translationText } from './lyric-document';
import type { LyricLine as AmllLine } from '@applemusic-like-lyrics/core';
import { lineText, type LyricDocument, type LyricLine, type RomanizationContent } from './lyric-document';

export type PreviewLine = { id: string; lyric: AmllLine };
export const isPunctuation = (text: string) => /^[\p{P}]+$/u.test(text);
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
  const leadAgent = document.agents.every(agent=>['v1','v2'].includes(agent.id)&&agent.name===null&&agent.type==='person'&&!agent.actorRef) ? 'v1' : document.agents.find((agent) => document.lines.some((line) => line.agentRefs.includes(agent.id)))?.id;
  const backgrounds = new Map<string, LyricLine[]>();
  for (const line of document.lines) if (line.backgroundOf) {
    const group = backgrounds.get(line.backgroundOf) ?? [];
    group.push(line); backgrounds.set(line.backgroundOf, group);
  }
  const ordered = document.lines.filter(line => !line.backgroundOf).flatMap(line => [line, ...(backgrounds.get(line.id) ?? [])]);
  return ordered.flatMap((line) => {
    const timedWords = line.words.filter((word) => valid(word.beginMs, word.endMs) || isPunctuation(word.text) && word.beginMs !== null && word.endMs === word.beginMs);
    const begin = line.beginMs ?? timedWords[0]?.beginMs ?? null;
    const end = line.endMs ?? timedWords.at(-1)?.endMs ?? null;
    if (!valid(begin, end)) return [];
    const contents = document.romanizationTracks.filter((track) => !trackId || track.id === trackId)
      .flatMap((track) => track.contents.filter((content) => content.lineId === line.id));
    const roman = showRomanization ? previewRomanization(line, contents[0]) : { text: '', words: new Map<string, string>() };
    const projectedWords = line.words.map((word, index) => {
      if (!isPunctuation(word.text) || word.beginMs !== null || word.endMs !== null) return word;
      const before = line.words.slice(0, index).reverse().find(item => valid(item.beginMs, item.endMs));
      const after = line.words.slice(index + 1).find(item => valid(item.beginMs, item.endMs));
      const neighbor = /^[\p{Ps}\p{Pi}]+$/u.test(word.text) ? after ?? before : before ?? after;
      return neighbor ? { ...word, beginMs: neighbor.beginMs, endMs: neighbor.endMs } : word;
    });
    const words: AmllLine['words'] = timedWords.length ? projectedWords.filter((word) => valid(word.beginMs, word.endMs) || isPunctuation(word.text) && word.beginMs !== null && word.endMs === word.beginMs || /^\s+$/u.test(word.text)).map((word) => ({
      word: word.text,
      startTime: /^\s+$/u.test(word.text) ? 0 : milliseconds(word.beginMs!), endTime: /^\s+$/u.test(word.text) ? 0 : milliseconds(word.endMs!),
      romanWord: roman.words.get(word.id) || undefined, obscene: word.obscene,
      ruby: word.rubyUnits.filter((unit) => valid(unit.beginMs, unit.endMs)).map((unit) => ({ word: unit.reading, startTime: milliseconds(unit.beginMs!), endTime: milliseconds(unit.endMs!) })),
    })) : [{ word: lineText(line), startTime: milliseconds(begin), endTime: milliseconds(end!) }];
    return [{ id: line.id, lyric: {
      words, startTime: milliseconds(begin), endTime: milliseconds(end!),
      translatedLyric: showTranslation ? translationsForLine(document, line.id).map(translationText).join(' / ') : '',
      romanLyric: roman.words.size ? '' : roman.text,
      isBG: Boolean(line.backgroundOf), isDuet: Boolean(leadAgent && lineAgents(document,line).length && !lineAgents(document,line).includes(leadAgent)),
    } }];
  });
}
