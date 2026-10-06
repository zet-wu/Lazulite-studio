import type { ProjectEditing } from '../domain/project-editing';
import type { LyricDocument } from '../domain/lyric-document';
import { serializeLyricTtml } from './ttml/lyric-codec';
import { assertOutputDocument } from './output-validation';
export function validatePublishDocument(document: LyricDocument, editing?: ProjectEditing): string {
 assertOutputDocument(document,'publish',editing);
 return serializeLyricTtml(document,{editing});
}
