import type { LyricDocument } from '../domain/lyric-document';
import { serializeLyricTtml } from './ttml/lyric-codec';
export function validatePublishDocument(document: LyricDocument): string {
 for (const [i,line] of document.lines.entries()) {
   if (line.beginUs === null || line.endUs === null || line.endUs <= line.beginUs) throw new Error(`第 ${i+1} 行需要完整开始和结束时间`);
   for (const [j,word] of line.words.entries()) {
     if (!word.text.trim() && word.beginUs === null && word.endUs === null && !word.rubyUnits.length) continue;
     if (word.beginUs === null || word.endUs === null) throw new Error(`第 ${i+1} 行第 ${j+1} 单元需要完整时间`);
     if (word.rubyUnits.some(u=>u.beginUs === null || u.endUs === null)) throw new Error(`第 ${i+1} 行 Ruby 需要完整时间`);
   }
 }
 return serializeLyricTtml(document);
}
