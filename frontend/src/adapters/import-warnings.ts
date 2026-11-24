import type {LyricDocument} from '../domain/lyric-document';
export type ImportWarning = {key:string; count:number};
export function addImportWarning(warnings:ImportWarning[], key:string) {
  const item=warnings.find(item=>item.key===key);
  if(item)item.count++;else warnings.push({key,count:1});
}
export const importedWarnings = new WeakMap<LyricDocument,ImportWarning[]>();
