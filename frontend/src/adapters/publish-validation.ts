import type { LyricDocument } from '../domain/lyric-document';
import { serializeLyricTtml } from './ttml/lyric-codec';
import { assertOutputDocument } from './output-validation';
export function validatePublishDocument(document: LyricDocument): string {
 assertOutputDocument(document,'publish');
 return serializeLyricTtml(document);
}
