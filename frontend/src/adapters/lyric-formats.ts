import { parseEslrc, parseLrc, parseLys, parseQrc, parseYrc, stringifyAss, stringifyEslrc, stringifyLrc, stringifyLys, stringifyQrc, stringifyYrc, type LyricLine as FormatLine } from '@applemusic-like-lyrics/lyric';
import { createLine, createLyricDocument, createWord, type LyricDocument } from '../domain/lyric-document';
import { parseLyricTtml, serializeLyricTtml } from './ttml/lyric-codec';

export type LyricFormat = 'ttml' | 'txt' | 'lrc' | 'eslrc' | 'qrc' | 'yrc' | 'lys' | 'ass';
const parseTimed = { lrc: parseLrc, eslrc: parseEslrc, qrc: parseQrc, yrc: parseYrc, lys: parseLys };
const stringifyTimed = { lrc: stringifyLrc, eslrc: stringifyEslrc, qrc: stringifyQrc, yrc: stringifyYrc, lys: stringifyLys, ass: stringifyAss };
const maximumSize = 4_000_000;
const microseconds = (ms: number): number => {
  if (!Number.isFinite(ms) || ms < 0) throw new Error('歌词时间无效');
  return Math.round(ms * 1000);
};

export function detectLyricFormat(name: string): LyricFormat {
  const extension = name.split('.').at(-1)?.toLowerCase();
  if (extension === 'xml') return 'ttml';
  if (extension && ['ttml', 'txt', 'lrc', 'eslrc', 'qrc', 'yrc', 'lys', 'ass'].includes(extension)) return extension as LyricFormat;
  throw new Error('不支持此文件格式');
}

export function importLyricFile(content: string, format: Exclude<LyricFormat, 'ass'>): LyricDocument {
  if (new TextEncoder().encode(content).length > maximumSize) throw new Error('歌词文件不能超过 4 MB');
  if (format === 'ttml') return parseLyricTtml(content);
  if (format === 'txt') {
    const text = content.replace(/^\uFEFF/, '').split(/\r?\n/).filter((value) => value.trim());
    if (!text.length || text.length > 20_000) throw new Error('歌词行数无效');
    return { ...createLyricDocument(), lines: text.map((value) => createLine(value)) };
  }
  const parsed = parseTimed[format](content);
  if (!parsed.length || parsed.length > 20_000) throw new Error('未解析出歌词行或行数过多');
  let mainId: string | null = null;
  const lines = parsed.map((item) => {
    const line = createLine('');
    if (item.isBG && mainId) line.backgroundOf = mainId;
    else mainId = line.id;
    line.duet = item.isDuet;
    line.beginUs = microseconds(item.startTime); line.endUs = microseconds(item.endTime);
    if (line.endUs < line.beginUs) throw new Error('歌词时间倒序');
    line.words = item.words.map((word) => ({ ...createWord(word.word), beginUs: microseconds(word.startTime), endUs: microseconds(word.endTime), romanization: word.romanWord ?? '' }));
    line.translations = item.translatedLyric ? [{ language: null, text: item.translatedLyric }] : [];
    line.romanizations = item.romanLyric ? [{ language: null, text: item.romanLyric }] : [];
    return line;
  });
  return { ...createLyricDocument(), lines };
}

export function exportLyricFile(document: LyricDocument, format: LyricFormat, draft = false): string {
  if (format === 'ttml') return serializeLyricTtml(document, { draft });
  if (format === 'txt') return document.lines.filter((line) => !line.backgroundOf).map((line) => line.words.map((word) => word.text).join('')).join('\n') + '\n';
  const lines: FormatLine[] = document.lines.map((line) => {
    if (line.beginUs === null || line.endUs === null || line.endUs <= line.beginUs) throw new Error('导出前请补全每行时间');
    const words = line.words.map((word) => {
      const begin = word.beginUs ?? (line.words.length === 1 ? line.beginUs : null);
      const end = word.endUs ?? (line.words.length === 1 ? line.endUs : null);
      if (begin === null || end === null || end <= begin) throw new Error('导出前请补全逐词时间');
      return { word: word.text, startTime: Math.round(begin / 1000), endTime: Math.round(end / 1000), romanWord: word.romanization || undefined };
    });
    return { words, startTime: Math.round(line.beginUs / 1000), endTime: Math.round(line.endUs / 1000),
      translatedLyric: line.translations.map((item) => item.text).join(' / '), romanLyric: line.romanizations.map((item) => item.text).join(' / '), isBG: Boolean(line.backgroundOf), isDuet: line.duet };
  });
  return stringifyTimed[format](lines);
}
