import type { LyricDocument, LyricLine } from './lyric-document';
import { message, type Message } from './messages';

export function lineLabel(document: LyricDocument, line: LyricLine): Message {
  const main = document.lines.filter(item => !item.backgroundOf);
  const number=main.findIndex(item=>item.id===(line.backgroundOf??line.id))+1;
  return line.backgroundOf ? message('split.backgroundLine',{number}) : message('editor.lineLabel',{number});
}

export function lineStructureIssues(_document: LyricDocument, first: LyricLine): Message[] {
  const issues: Message[]=[];
  if(first.backgroundOf)issues.push(message('split.backgroundCannotSplit'));
  if(first.words.length<2)issues.push(message('split.noWordBoundary'));
  return issues;
}
