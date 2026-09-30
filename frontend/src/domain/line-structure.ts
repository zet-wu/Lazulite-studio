import type { LyricDocument, LyricLine } from './lyric-document';

export function lineLabel(document: LyricDocument, line: LyricLine): string {
  const main = document.lines.filter(item => !item.backgroundOf);
  return line.backgroundOf ? `L${main.findIndex(item => item.id === line.backgroundOf) + 1} 的背景歌词` : `L${main.findIndex(item => item.id === line.id) + 1}`;
}

/** Shared by entry points and the atomic command; only actual conflicts are reported. */
export function lineStructureIssues(document: LyricDocument, first: LyricLine, second?: LyricLine): string[] {
  const label = (line: LyricLine) => lineLabel(document, line);
  const issues: string[] = [];
  if (!second) {
    if (first.backgroundOf) issues.push(`${label(first)}不能直接拆分`);
    if (first.words.length < 2) issues.push(`${label(first)}没有可拆分的词边界`);
    if (first.translations.length) issues.push(`${label(first)}有翻译`);
    return issues;
  }
  const main = document.lines.filter(item => !item.backgroundOf);
  if (first.backgroundOf || second.backgroundOf || main.indexOf(second) !== main.indexOf(first) + 1) issues.push('只能合并相邻主行');
  for (const line of [first, second]) {
    if (document.lines.some(item => item.backgroundOf === line.id)) issues.push(`${label(line)}有背景歌词`);
    if (line.translations.length) issues.push(`${label(line)}有翻译`);
  }
  if (first.songPart !== second.songPart) issues.push(`${label(first)}与${label(second)}歌曲段落不同`);
  if (first.agentRefs.join(' ') !== second.agentRefs.join(' ')) issues.push(`${label(first)}与${label(second)}歌手不同`);
  if (first.endLink && first.endLink.targetLineId !== second.id) {
    const target = document.lines.find(item => item.id === first.endLink!.targetLineId)!;
    issues.push(`${label(first)}行尾链接 → ${label(target)}在合并范围外`);
  }
  // A last-line link back into the range would become a self-link.
  if (second.endLink && [first.id, second.id].includes(second.endLink.targetLineId)) issues.push(`${label(second)}行尾链接指向合并范围内的开始边界`);
  const mergedBegin = first.beginUs ?? second.beginUs;
  for (const source of document.lines) {
    if (source.id === first.id || source.id === second.id || source.endLink?.targetLineId !== second.id) continue;
    if (mergedBegin !== second.beginUs) issues.push(`${label(source)}行尾链接 → ${label(second)}的开始边界将在合并后消失`);
  }
  return issues;
}
