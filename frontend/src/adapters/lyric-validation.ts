import type { LyricDocument } from '../domain/lyric-document';
import { isPunctuation } from '../domain/preview-adapter';
import { exportLyricFile, type LyricFormat } from './lyric-formats';
import { collectOutputIssues, DocumentOutputError, outputIssueKey, type OutputIssue } from './output-validation';

export const checkedFormats: Exclude<LyricFormat, 'krc'>[] = ['ttml', 'txt', 'lrc', 'elrc', 'eslrc', 'qrc', 'yrc', 'lys', 'ass'];
/** Runs the actual serializers in memory; no download, persistence or history effects. */
export function validateLyrics(document: LyricDocument): OutputIssue[] {
  const result = new Map<string, OutputIssue>();
  const add = (issue: OutputIssue, format: string, severity: NonNullable<OutputIssue['severity']>) => {
    const key = `${outputIssueKey(issue)}:${severity}`, previous = result.get(key);
    result.set(key, { ...issue, severity, formats: [...new Set([...(previous?.formats ?? []), format])] });
  };
  for (const format of checkedFormats) {
    try { exportLyricFile(document, format); }
    catch (cause) {
      const issues = cause instanceof DocumentOutputError ? cause.issues : [{ kind: 'line' as const, lineId: '', missing: [], code: 'serialization' as const, message: cause instanceof Error ? cause.message : '序列化失败' }];
      issues.forEach(issue => add(issue, format.toUpperCase(), 'error'));
    }
  }
  collectOutputIssues(document, 'publish').forEach(issue => add(issue, '发布歌词', 'error'));
  for (const line of document.lines) {
    if (line.beginMs !== null || line.endMs !== null || line.words.some(word => word.beginMs !== null || word.endMs !== null)) add({ kind: 'line', lineId: line.id, code: 'loss-timing', missing: [], message: '纯文本不保留行及逐词时间' }, 'TXT', 'loss');
    if (line.words.some(word => word.beginMs !== null || word.endMs !== null)) add({ kind: 'line', lineId: line.id, code: 'loss-timing', missing: [], message: '普通 LRC 不保留逐词时间' }, 'LRC', 'loss');
    for (const word of line.words) {
      if (isPunctuation(word.text)) {
        const missing: OutputIssue['missing'] = [...(word.beginMs === null ? ['begin' as const] : []), ...(word.endMs === null ? ['end' as const] : [])];
        if (missing.length || word.beginMs === word.endMs) add({ kind: 'word', lineId: line.id, wordId: word.id, code: missing.length ? 'missing-time' : 'punctuation-zero', missing,
          message: missing.length ? `标点「${word.text}」缺少${missing.length === 2 ? '开始和结束' : missing[0] === 'begin' ? '开始' : '结束'}时间` : `标点「${word.text}」起止时间相同` }, '时间核对', 'warning');
      }
      if (word.rubyUnits.length) for (const format of checkedFormats.filter(format => format !== 'ttml')) add({ kind: 'word', lineId: line.id, wordId: word.id, code: 'loss-ruby', missing: [], message: '此格式不保留 Ruby 结构及读音时间' }, format.toUpperCase(), 'loss');
    }
    if (line.backgroundOf) for (const format of ['TXT', 'LRC', 'ELRC']) add({ kind: 'line', lineId: line.id, code: 'loss-background', missing: [], message: '此格式不输出背景行' }, format, 'loss');
    if (document.translationTracks.some(track => track.contents.some(content => content.lineId === line.id))) for (const format of checkedFormats.filter(format => format !== 'ttml')) add({ kind: 'line', lineId: line.id, code: 'loss-translation', missing: [], message: format === 'ass' ? '翻译合为普通字幕，不保留轨道、语言、用途及单元时间' : '此格式不输出翻译内容及轨道信息' }, format.toUpperCase(), 'loss');
    if (document.romanizationTracks.some(track => track.contents.some(content => content.lineId === line.id))) for (const format of checkedFormats.filter(format => format !== 'ttml')) add({ kind: 'line', lineId: line.id, code: 'loss-romanization', missing: [], message: format === 'ass' ? '仅输出预览中的整行音译投影；逐词附着音译、多轨及语言信息不保留' : '此格式不输出音译内容及轨道信息' }, format.toUpperCase(), 'loss');
  }
  return [...result.values()];
}
