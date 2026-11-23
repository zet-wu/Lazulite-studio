import { z } from 'zod';
import { createLine, createWord, type LyricLine } from '../../../frontend/src/domain/lyric-document';
import { previewLineSplit, type LyricCommand } from '../../../frontend/src/domain/lyric-commands';
import { createProjectEditorState, executeProjectCommand, type ProjectDocument } from '../../../frontend/src/domain/project-document';
import { StudioHttpError } from '../client';
import { mutateProjectDocument } from './cas';
import { withOperationContext, type ToolRegistry } from './registry';

export const id = z.string().min(1);
export const time = z.number().int().nonnegative().nullable();
export const writeSchema = { project_id: id, expected_revision: id.optional(), idempotency_key: id.optional() };
export function invalid(message: string): never { throw new StudioHttpError(422, { code: 'invalid_edit', message, retryable: false }); }
export function requireLine(doc: ProjectDocument, lineId: string): LyricLine { return doc.lyrics.lines.find(line => line.id === lineId) ?? invalid(`Line "${lineId}" does not exist.`); }
export function requireWord(doc: ProjectDocument, lineId: string, wordId: string) { return requireLine(doc, lineId).words.find(word => word.id === wordId) ?? invalid(`Word "${wordId}" does not exist in line "${lineId}".`); }
export function run(doc: ProjectDocument, command: LyricCommand): ProjectDocument { return executeProjectCommand(createProjectEditorState(doc), { type: 'lyrics', command }).present; }
export function reference(refs: Record<string, string>, value: string): string { return Object.hasOwn(refs, value) ? refs[value] : value; }
export function remember(refs: Record<string, string>, key: string | undefined, value: string) { if (!key) return; if (Object.hasOwn(refs, key)) invalid(`Duplicate client_ref "${key}".`); refs[key] = value; }
const lineWord = { line_id: id, word_id: id };
const op = z.discriminatedUnion('op', [
  z.object({ op: z.literal('edit_word'), ...lineWord, text: id }),
  z.object({ op: z.literal('insert_word'), line_id: id, after_word_id: id.nullable(), text: id, begin_ms: time.optional(), end_ms: time.optional(), client_ref: id.optional() }),
  z.object({ op: z.literal('delete_word'), ...lineWord }),
  z.object({ op: z.literal('split_word'), ...lineWord, at: z.number().int().positive(), client_ref: id.optional() }),
  z.object({ op: z.literal('merge_words'), line_id: id, word_ids: z.array(id).min(2) }),
  z.object({ op: z.literal('move_word'), ...lineWord, to_line_id: id, after_word_id: id.nullable() }),
  z.object({ op: z.literal('insert_line'), after_line_id: id.nullable(), text: z.string().default(''), background_of: id.nullable().optional(), client_ref: id.optional() }),
  z.object({ op: z.literal('delete_line'), line_id: id }),
  z.object({ op: z.literal('move_line'), line_id: id, after_line_id: id.nullable() }),
  z.object({ op: z.literal('split_line'), line_id: id, before_word_id: id, client_ref: id.optional(),
    content_targets: z.record(z.number().int().min(0).max(1)).optional(), translation_targets: z.record(z.number().int().min(0).max(1)).optional(), background_targets: z.record(z.number().int().min(0).max(1)).optional() }),
  z.object({ op: z.literal('merge_lines'), line_ids: z.array(id).min(2) }),
  z.object({ op: z.literal('set_background_of'), line_id: id, parent_line_id: id.nullable() }),
  z.object({ op: z.literal('set_line_flags'), line_id: id, song_part: z.string().nullable().optional(), skip_alignment: z.boolean().optional(), skip_sync: z.boolean().optional() }),
]);

export function registerEditingTools(registry: ToolRegistry) {
  registry.register({ name: 'edit_lyrics', description: 'Atomically edit local lyric words and line structure with shared desktop domain commands. IDs may reference earlier client_ref values. split_line keeps attached contents/backgrounds on the first segment by default; explicit *_targets select segment 0 or 1.', annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    inputSchema: { ...writeSchema, operations: z.array(op).min(1) },
    execute: async (args, { client }) => mutateProjectDocument(client, args.project_id, { expectedRevision: args.expected_revision, idempotencyKey: args.idempotency_key }, (doc, envelope) => {
      let next = doc;
      const refs: Record<string, string> = Object.create(null), affected = new Set<string>();
      const resolve = (value: string) => reference(refs, value), nullable = (value: string | null) => value === null ? null : resolve(value);
      args.operations.forEach((operation, index) => withOperationContext(operation, index, envelope.revision, () => {
        const lineId = 'line_id' in operation ? resolve(operation.line_id) : undefined;
        const wordId = 'word_id' in operation ? resolve(operation.word_id) : undefined;
        if (lineId) { requireLine(next, lineId); affected.add(lineId); }
        let command: LyricCommand;
        switch (operation.op) {
          case 'edit_word': command = { type: 'edit-word', lineId: lineId!, wordId: wordId!, text: operation.text }; break;
          case 'insert_word': {
            const word = { ...createWord(operation.text), beginMs: operation.begin_ms ?? null, endMs: operation.end_ms ?? null };
            remember(refs, operation.client_ref, word.id); command = { type: 'insert-word', lineId: lineId!, afterWordId: nullable(operation.after_word_id), word }; break;
          }
          case 'delete_word': command = { type: 'delete-word', lineId: lineId!, wordId: wordId! }; break;
          case 'split_word': { const newWordId = crypto.randomUUID(); remember(refs, operation.client_ref, newWordId); command = { type: 'split-word', lineId: lineId!, wordId: wordId!, at: operation.at, newWordId }; break; }
          case 'merge_words': {
            operation.word_ids.forEach(value => requireWord(next, lineId!, resolve(value)));
            command = { type: 'merge-words', wordIds: operation.word_ids.map(resolve) }; break;
          }
          case 'move_word': affected.add(resolve(operation.to_line_id)); command = { type: 'move-word', lineId: lineId!, wordId: wordId!, toLineId: resolve(operation.to_line_id), afterWordId: nullable(operation.after_word_id) }; break;
          case 'insert_line': {
            const line = { ...createLine(operation.text), backgroundOf: operation.background_of ? resolve(operation.background_of) : null };
            remember(refs, operation.client_ref, line.id); affected.add(line.id); command = { type: 'insert-line', afterLineId: nullable(operation.after_line_id), line }; break;
          }
          case 'delete_line': command = { type: 'delete-line', lineId: lineId! }; break;
          case 'move_line': command = { type: 'move-line', lineId: lineId!, afterLineId: nullable(operation.after_line_id) }; break;
          case 'split_line': {
            const line = requireLine(next, lineId!); previewLineSplit(line, [resolve(operation.before_word_id)]);
            const newId = crypto.randomUUID(); remember(refs, operation.client_ref, newId); affected.add(newId);
            const targets = (tracks: typeof next.lyrics.romanizationTracks, supplied?: Record<string, number>) => Object.fromEntries(tracks.flatMap(track => track.contents.filter(content => content.lineId === line.id).map(content => [content.id, supplied?.[content.id] ?? 0])));
            command = { type: 'split-line', lineId: line.id, beforeWordIds: [resolve(operation.before_word_id)], newLineIds: [newId],
              contentTargets: targets(next.lyrics.romanizationTracks, operation.content_targets), translationTargets: targets(next.lyrics.translationTracks, operation.translation_targets),
              backgroundTargets: Object.fromEntries(next.lyrics.lines.filter(bg => bg.backgroundOf === line.id).map(bg => [bg.id, operation.background_targets?.[bg.id] ?? 0])) }; break;
          }
          case 'merge_lines': operation.line_ids.forEach(value => affected.add(resolve(value))); command = { type: 'merge-lines', lineIds: operation.line_ids.map(resolve) }; break;
          case 'set_background_of': command = { type: 'set-background-of', lineId: lineId!, parentLineId: nullable(operation.parent_line_id) }; break;
          case 'set_line_flags': command = { type: 'batch', commands: [
            ...(operation.song_part !== undefined ? [{ type: 'set-song-part' as const, lineIds: [lineId!], value: operation.song_part }] : []),
            ...(operation.skip_alignment !== undefined ? [{ type: 'set-skip-alignment' as const, lineId: lineId!, skip: operation.skip_alignment }] : []),
            ...(operation.skip_sync !== undefined ? [{ type: 'set-ignore-sync' as const, lineId: lineId!, ignoreSync: operation.skip_sync }] : []),
          ] }; break;
        }
        next = run(next, command);
      }));
      return { nextDoc: next, summary: { created_refs: refs, affected_line_ids: [...affected], operations_applied: args.operations.length } };
    }),
  });
}
