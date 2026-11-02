import { lineLabel as describeLine } from '../domain/line-structure';
import { formatMessage } from '../i18n';
import type { LyricDocument, LyricLine } from '../domain/lyric-document';
export const lineLabel=(document:LyricDocument,line:LyricLine)=>formatMessage(describeLine(document,line));
