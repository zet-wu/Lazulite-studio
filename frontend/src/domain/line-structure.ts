import type { LyricDocument, LyricLine } from './lyric-document';

export function lineLabel(document: LyricDocument, line: LyricLine): string {
  const main = document.lines.filter(item => !item.backgroundOf);
  return line.backgroundOf ? `L${main.findIndex(item => item.id === line.backgroundOf) + 1} 的背景歌词` : `L${main.findIndex(item => item.id === line.id) + 1}`;
}

/** Shared by entry points and the atomic command; only actual conflicts are reported. */
export function lineStructureIssues(document: LyricDocument, first: LyricLine): string[] {
  const issues: string[] = [];
  if (first.backgroundOf) issues.push(`${lineLabel(document, first)}不能直接拆分`);
  if (first.words.length < 2) issues.push(`${lineLabel(document, first)}没有可拆分的词边界`);
  return issues;
}
