import type { ProjectEditing } from '../domain/project-editing';
import type { LyricDocument } from '../domain/lyric-document';
import { isPunctuation } from '../domain/preview-adapter';
import { exportLyricFile, exportFormats } from './lyric-formats';
import { DocumentOutputError, outputIssueKey, type OutputIssue } from './output-validation';

export const checkedFormats = exportFormats.map(([format]) => format);
/** Runs the actual serializers in memory; no download, persistence or history effects. */
function* validationSteps(document: LyricDocument, editing?: ProjectEditing): Generator<void, OutputIssue[]> {
  const result = new Map<string, OutputIssue>();
  const add = (issue: OutputIssue, format: string, severity: NonNullable<OutputIssue['severity']>) => {
    const key = `${outputIssueKey(issue)}:${severity}`, previous = result.get(key);
    result.set(key, { ...issue, severity, formats: [...new Set([...(previous?.formats ?? []), format])] });
  };
  for (const format of checkedFormats) {
    try { exportLyricFile(document, format,editing); }
    catch (cause) {
      const issues = cause instanceof DocumentOutputError ? cause.issues : [{ kind: 'line' as const, lineId: '', missing: [], code: 'serialization' as const, message: cause instanceof Error ? cause.message : '序列化失败' }];
      issues.forEach(issue => add(issue, format.toUpperCase(), 'error'));
    }
    yield;
  }
  for (const line of document.lines) {
    for (const word of line.words) {
      if (isPunctuation(word.text)) {
        const missing: OutputIssue['missing'] = [...(word.beginMs === null ? ['begin' as const] : []), ...(word.endMs === null ? ['end' as const] : [])];
        if (missing.length || word.beginMs === word.endMs) add({ kind: 'word', lineId: line.id, wordId: word.id, code: missing.length ? 'missing-time' : 'punctuation-zero', missing,
          message: missing.length ? `标点「${word.text}」缺少${missing.length === 2 ? '开始和结束' : missing[0] === 'begin' ? '开始' : '结束'}时间` : `标点「${word.text}」起止时间相同` }, '时间核对', 'warning');
      }
    }
  }
  return [...result.values()];
}

/** Synchronous callers retain the identical full check. */
export function validateLyrics(document: LyricDocument, editing?: ProjectEditing): OutputIssue[] {
  const steps=validationSteps(document,editing);
  let step=steps.next();
  while(!step.done) step=steps.next();
  return step.value;
}
/** Give input and paint a turn between actual serializers; abort superseded snapshots. */
export async function validateLyricsIncrementally(document: LyricDocument, editing: ProjectEditing, signal: AbortSignal): Promise<OutputIssue[]> {
  const steps=validationSteps(document,editing);
  while(true) {
    signal.throwIfAborted();
    const step=steps.next();
    if(step.done)return step.value;
    await new Promise<void>(resolve=>setTimeout(resolve,0));
  }
}
