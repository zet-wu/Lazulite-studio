import { parseWordFormat, parseLrcSource } from './source-codec';
import { assertOutputDocument } from './output-validation';
import { renderLrc } from './lrc';
import { parseEslrc, parseLrc, parseLys, parseQrc, parseYrc, stringifyAss, stringifyEslrc, stringifyLrc, stringifyLys, stringifyQrc, stringifyYrc, type LyricLine as FormatLine } from '@applemusic-like-lyrics/lyric';
import { createLine, createLyricDocument, createWord, type LyricDocument, type RomanizationTrack } from '../domain/lyric-document';
import { toAmllLines } from '../domain/preview-adapter';
import { parseLyricTtml, serializeLyricTtml } from './ttml/lyric-codec';

export type LyricFormat = 'ttml' | 'txt' | 'lrc' | 'elrc' | 'eslrc' | 'qrc' | 'krc' | 'yrc' | 'lys' | 'ass';
const parseTimed = { elrc: parseLrc, lrc: parseLrc, eslrc: parseEslrc, qrc: parseQrc, yrc: parseYrc, lys: parseLys };
const stringifyTimed = { lrc: stringifyLrc, eslrc: stringifyEslrc, qrc: stringifyQrc, yrc: stringifyYrc, lys: stringifyLys, ass: stringifyAss };
const maximumSize = 4_000_000;
const milliseconds = (ms: number): number => {
  if (!Number.isFinite(ms) || ms < 0) throw new Error('歌词时间无效');
  return Math.round(ms);
};

export function detectLyricFormat(name: string): LyricFormat {
  const extension = name.split('.').at(-1)?.toLowerCase();
  if (extension === 'xml') return 'ttml';
  if (extension && ['ttml', 'txt', 'lrc', 'elrc', 'eslrc', 'qrc', 'krc', 'yrc', 'lys', 'ass'].includes(extension)) return extension as LyricFormat;
  throw new Error('不支持此文件格式');
}

export function importLyricFile(content: string, format: Exclude<LyricFormat, 'ass'>, onSidecarIssue?: () => void): LyricDocument {
  if (new TextEncoder().encode(content).length > maximumSize) throw new Error('歌词文件不能超过 4 MB');
  if (format === 'ttml') return parseLyricTtml(content);
  if (format === 'txt') {
    const text = content.replace(/^\uFEFF/, '').split(/\r?\n/).filter((value) => value.trim());
    if (!text.length || text.length > 20_000) throw new Error('歌词行数无效');
    return { ...createLyricDocument(), lines: text.map((value) => createLine(value)) };
  }
  if (format === 'krc' || format === 'yrc' || format === 'qrc') return parseWordFormat(content, format, onSidecarIssue);
  if (format === 'lrc' || format === 'elrc') return parseLrcSource(content);
  const parsed = parseTimed[format](content);
  if (!parsed.length || parsed.length > 20_000) throw new Error('未解析出歌词行或行数过多');
  let mainId: string | null = null;
  const timedTrack: RomanizationTrack = { id: crypto.randomUUID(), language: null, contents: [] };
  const plainTrack: RomanizationTrack = { id: crypto.randomUUID(), language: null, contents: [] };
  const lines = parsed.map((item) => {
    const line = createLine('');
    if (item.isBG && mainId) line.backgroundOf = mainId;
    else mainId = line.id;
    line.agentRefs = item.isDuet ? ['v2'] : ['v1'];
    line.beginMs = milliseconds(item.startTime); line.endMs = milliseconds(item.endTime);
    if (line.endMs < line.beginMs) throw new Error('歌词时间倒序');
    line.words = item.words.map((word) => ({ ...createWord(word.word), beginMs: milliseconds(word.startTime), endMs: milliseconds(word.endTime) }));
    const romanUnits = item.words.filter((word) => word.romanWord !== undefined).map((word) => ({ id: crypto.randomUUID(), text: word.romanWord ?? '', beginMs: milliseconds(word.startTime), endMs: milliseconds(word.endTime) }));
    if (romanUnits.length) timedTrack.contents.push({ id: crypto.randomUUID(), lineId: line.id, kind: 'timed', units: romanUnits });
    line.translations = item.translatedLyric ? [{ language: null, text: item.translatedLyric }] : [];
    if (item.romanLyric) plainTrack.contents.push({ id: crypto.randomUUID(), lineId: line.id, kind: 'plain', text: item.romanLyric });
    return line;
  });
  return { ...createLyricDocument(), lines,
    agents: [{ id: 'v1', name: null, type: 'person' }, { id: 'v2', name: null, type: 'person' }],
    romanizationTracks: [timedTrack, plainTrack].filter((track) => track.contents.length) };
}

export function exportLyricFile(document: LyricDocument, format: LyricFormat): string {
  if (format === 'krc') throw new Error('KRC 目前仅支持导入');
  assertOutputDocument(document,format);
  if (format === 'ttml') return serializeLyricTtml(document);
  if (format === 'txt') return document.lines.filter((line) => !line.backgroundOf).map((line) => line.words.map((word) => word.text).join('')).join('\n') + '\n';
  if (format === 'lrc' || format === 'elrc') return renderLrc(document, format).text;
  const preview = new Map(toAmllLines(document, false, true).map((item) => [item.id, item.lyric]));
  const lines: FormatLine[] = document.lines.map((line) => {
    if (line.beginMs === null || line.endMs === null || line.endMs <= line.beginMs) throw new Error('导出前请补全每行时间');
    const words = line.words.map((word, index) => {
      const begin = word.beginMs ?? (line.words.length === 1 ? line.beginMs : null);
      const end = word.endMs ?? (line.words.length === 1 ? line.endMs : null);
      if (begin === null || end === null || end <= begin) throw new Error('导出前请补全逐词时间');
      return { word: word.text, startTime: begin, endTime: end, romanWord: preview.get(line.id)?.words[index]?.romanWord };
    });
    return { words, startTime: line.beginMs, endTime: line.endMs,
      translatedLyric: line.translations.map((item) => item.text).join(' / '), romanLyric: preview.get(line.id)?.romanLyric ?? '', isBG: Boolean(line.backgroundOf), isDuet: preview.get(line.id)?.isDuet ?? false };
  });
  return stringifyTimed[format](lines);
}
