import type { ProjectEditing } from '../domain/project-editing';
import { prepareAss, renderAss } from './ass';
import { projectExportSeparators } from './export-separators';
import { plainTranslation } from '../domain/lyric-document';
import { parseWordFormat, parseLrcSource } from './source-codec';
import { assertOutputDocument, DocumentOutputError } from './output-validation';
import { renderLrc } from './lrc';
import { parseEslrc, parseLrc, parseLys, parseQrc, parseYrc, stringifyEslrc, type LyricLine as FormatLine } from '@applemusic-like-lyrics/lyric';
import { createLine, createLyricDocument, createWord, type LyricDocument, type RomanizationTrack, type TranslationTrack } from '../domain/lyric-document';
import { parseLyricTtml, serializeLyricTtml } from './ttml/lyric-codec';

export type LyricFormat = 'ttml' | 'txt' | 'lrc' | 'elrc' | 'eslrc' | 'qrc' | 'krc' | 'yrc' | 'lys' | 'ass';
export const exportFormats = [
  ['ttml', 'TTML'], ['txt', '纯文本 TXT'], ['lrc', '普通 LRC'], ['elrc', '扩展 LRC（尖括号）'],
  ['eslrc', 'ESLRC（正文后方括号）'], ['qrc', 'QRC'], ['yrc', 'YRC'], ['lys', 'LYS'], ['ass', 'ASS'],
] as const;
export type ExportFormat = typeof exportFormats[number][0];
export type ValidationFilter = ExportFormat | 'all' | 'nicokara';
const parseTimed = { elrc: parseLrc, lrc: parseLrc, eslrc: parseEslrc, qrc: parseQrc, yrc: parseYrc, lys: parseLys };
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

export function importLyricFile(content: string, format: Exclude<LyricFormat, 'ass'>, onSidecarIssue?: () => void, lineTimedWords?: Set<string>): LyricDocument {
  if (new TextEncoder().encode(content).length > maximumSize) throw new Error('歌词文件不能超过 4 MB');
  if (format === 'ttml') return parseLyricTtml(content);
  if (format === 'txt') {
    const text = content.replace(/^\uFEFF/, '').split(/\r?\n/).filter((value) => value.trim());
    if (!text.length || text.length > 20_000) throw new Error('歌词行数无效');
    return { ...createLyricDocument(), lines: text.map((value) => createLine(value)) };
  }
  if (format === 'krc' || format === 'yrc' || format === 'qrc') return parseWordFormat(content, format, onSidecarIssue);
  if (format === 'lrc' || format === 'elrc') return parseLrcSource(content, lineTimedWords);
  const parsed = parseTimed[format](content);
  if (!parsed.length || parsed.length > 20_000) throw new Error('未解析出歌词行或行数过多');
  let mainId: string | null = null;
  const timedTrack: RomanizationTrack = { id: crypto.randomUUID(), language: null, contents: [] };
  const plainTrack: RomanizationTrack = { id: crypto.randomUUID(), language: null, contents: [] };
  const translationTrack: TranslationTrack = { id: crypto.randomUUID(), language: null, purpose: 'subtitle', contents: [] };
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
    if (item.translatedLyric) translationTrack.contents.push(plainTranslation(item.translatedLyric, line.id));
    if (item.romanLyric) plainTrack.contents.push({ id: crypto.randomUUID(), lineId: line.id, kind: 'plain', text: item.romanLyric });
    return line;
  });
  return { ...createLyricDocument(), lines, translationTracks: translationTrack.contents.length ? [translationTrack] : [],
    agents: [{ id: 'v1', name: null, type: 'person' }, { id: 'v2', name: null, type: 'person' }],
    romanizationTracks: [timedTrack, plainTrack].filter((track) => track.contents.length) };
}

export function exportLyricFile(document: LyricDocument, format: LyricFormat, editing?: ProjectEditing): string {
  if (format === 'krc') throw new Error('KRC 目前仅支持导入');
  if (format === 'ass') {
    const prepared = prepareAss(document,editing);
    if (prepared.issues.length) throw new DocumentOutputError(prepared.issues);
    return renderAss(prepared.events);
  }
  if (format === 'lrc' || format === 'elrc') return renderLrc(document,format,editing).text;
  assertOutputDocument(document,format,editing);
  if (format === 'ttml') return serializeLyricTtml(document,{editing});
  if (format === 'txt') return document.lines.filter((line) => !line.backgroundOf).map((line) => line.words.map((word) => word.text).join('')).join('\n') + '\n';
  const leadAgent = document.agents.find(agent => document.lines.some(line => line.agentRefs.includes(agent.id)))?.id;
  const lines: FormatLine[] = document.lines.map((line) => {
    if (line.beginMs === null || line.endMs === null || line.endMs <= line.beginMs) throw new Error('导出前请补全每行时间');
    const words = projectExportSeparators(line.words,editing).units.map(word => {
      const begin = word.beginMs;
      const end = word.endMs;
      if (begin === null || end === null || end <= begin) throw new Error('导出前请补全逐词时间');
      return { word: word.text, startTime: begin, endTime: end };
    });
    return { words, startTime: line.beginMs, endTime: line.endMs,
      translatedLyric: '', romanLyric: '', isBG: Boolean(line.backgroundOf), isDuet: Boolean(leadAgent && line.agentRefs.length && !line.agentRefs.includes(leadAgent)) };
  });
  // The library drops timed whitespace-only QRC/YRC words, including a background closing bracket.
  if (format === 'qrc' || format === 'yrc') return lines.map(line => `[${line.startTime},${line.endTime-line.startTime}]` + line.words.map((word,index) => {
    const text = `${line.isBG && index === 0 ? '（' : ''}${word.word}${line.isBG && index === line.words.length-1 ? '）' : ''}`;
    return format === 'qrc' ? `${text}(${word.startTime},${word.endTime-word.startTime})` : `(${word.startTime},${word.endTime-word.startTime},0)${text}`;
  }).join('')).join('\n');
  if (format === 'lys') return lines.map(line => `[${(line.isBG ? 6 : 0) + (line.isDuet ? 2 : 1)}]` + line.words.map(word => `${word.word}(${word.startTime},${word.endTime-word.startTime})`).join('')).join('\n');
  return stringifyEslrc(lines);
}
