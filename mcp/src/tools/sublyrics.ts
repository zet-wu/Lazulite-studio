import { z } from 'zod';
import { displayLines } from '../../../frontend/src/domain/amll-compatibility';
import { parseProject } from '../../../frontend/src/adapters/project-codec';
import { translationText, type TranslationContent, type TranslationTrack, type RomanizationTrack } from '../../../frontend/src/domain/lyric-document';
import { splitAtGrapheme } from '../../../frontend/src/domain/text-boundaries';
import type { ProjectDocument } from '../../../frontend/src/domain/project-document';
import type { LyricCommand } from '../../../frontend/src/domain/lyric-commands';
import { mutateProjectDocument } from './cas';
import { id, time, writeSchema, invalid, reference, remember, run } from './editing';
import { withOperationContext, type ToolRegistry } from './registry';

const kind = z.enum(['translation', 'romanization']);
const unit = z.object({ text: id, begin_ms: time.optional(), end_ms: time.optional(), client_ref: id.optional() });
const content = { content_kind: z.enum(['plain', 'timed']), text: z.string().optional(), units: z.array(unit).optional() };
const trackTarget = { kind, track_id: id.optional(), track_ref: id.optional() };
const contentTarget = { ...trackTarget, content_id: id };
const operations = z.discriminatedUnion('op', [
  z.object({ op: z.literal('create_track'), kind, language: z.string().nullable().default(null), purpose: z.enum(['subtitle','replacement']).default('subtitle'), client_ref: id.optional() }),
  z.object({ op: z.literal('update_track'), ...trackTarget, language: z.string().nullable().optional(), purpose: z.enum(['subtitle','replacement']).optional() }),
  z.object({ op: z.literal('delete_track'), ...trackTarget }),
  z.object({ op: z.literal('move_track'), ...trackTarget, after_track_id: id.nullable() }),
  z.object({ op: z.literal('insert_content'), ...trackTarget, ...content, line_id: id, after_content_id: id.nullable().optional(), client_ref: id.optional() }),
  z.object({ op: z.literal('update_content'), ...contentTarget, ...content }),
  z.object({ op: z.literal('delete_content'), ...contentTarget }),
  z.object({ op: z.literal('move_content'), ...contentTarget, line_id: id, to_track_id: id.optional(), after_content_id: id.nullable() }),
  z.object({ op: z.literal('update_unit'), ...contentTarget, unit_id: id, text: id.optional(), begin_ms: time.optional(), end_ms: time.optional() }),
  z.object({ op: z.literal('insert_unit'), ...contentTarget, ...unit.shape, after_unit_id: id.nullable() }),
  z.object({ op: z.literal('delete_unit'), ...contentTarget, unit_id: id }),
  z.object({ op: z.literal('split_unit'), ...contentTarget, unit_id: id, at: z.number().int().positive(), client_ref: id.optional() }),
  z.object({ op: z.literal('move_unit'), ...contentTarget, unit_id: id, after_unit_id: id.nullable() }),
]);

export function commitSublyricTracks(doc: ProjectDocument, kind: 'translation' | 'romanization', tracks: Array<TranslationTrack | RomanizationTrack>): ProjectDocument {
  if (kind === 'translation') return run(doc, { type: 'set-translation-tracks', source: doc.lyrics.translationTracks, tracks: tracks as TranslationTrack[] });
  const commands: Exclude<LyricCommand, { type: 'batch' }>[] = [
    ...doc.lyrics.romanizationTracks.map(track => ({ type: 'delete-romanization-track' as const, trackId: track.id })),
    ...tracks.flatMap(track => [{ type: 'add-romanization-track' as const, track: { ...track, contents: [] } }, ...track.contents.map(content => ({ type: 'insert-romanization-content' as const, trackId: track.id, content }))]),
  ];
  return run(doc, { type: 'batch', commands });
}
function position<T extends { id: string }>(items: T[], after: string | null) { if (after === null) return 0; const index = items.findIndex(item => item.id === after); if (index < 0) invalid(`Insertion anchor "${after}" does not exist.`); return index + 1; }
export function registerSublyricTools(registry: ToolRegistry) {
  registry.register({ name: 'get_sublyrics', description: 'Read translation/romanization tracks with stable content and unit IDs; paginate by lyric display lines.', annotations: { readOnlyHint: true, idempotentHint: true },
    inputSchema: { project_id: id, kind: z.enum(['translation','romanization','all']).default('all'), track_ids: z.array(id).min(1).optional(), line_ids: z.array(id).min(1).optional(), detail: z.enum(['summary','full']).default('full'), start_line: z.number().int().positive().default(1), limit: z.number().int().positive().max(200).default(50) },
    execute: async (args, { client }) => {
      const envelope = await client.getDocumentEnvelope(args.project_id), doc = parseProject(envelope.document), ordered = displayLines(doc.lyrics, doc.lineOrder);
      if (args.line_ids?.some(value => !ordered.some(line => line.id === value))) invalid('A requested line does not exist.');
      const selected = args.line_ids ? ordered.filter(line => args.line_ids!.includes(line.id)) : ordered.slice(args.start_line - 1, args.start_line - 1 + args.limit);
      const ids = new Set(selected.map(line => line.id));
      const tracks = (['translation','romanization'] as const).filter(value => args.kind === 'all' || args.kind === value).flatMap(value => (value === 'translation' ? doc.lyrics.translationTracks : doc.lyrics.romanizationTracks).filter(track => !args.track_ids || args.track_ids.includes(track.id)).map(track => ({ track_id: track.id, kind: value, language: track.language, ...('purpose' in track ? { purpose: track.purpose } : {}), contents: track.contents.filter(c => ids.has(c.lineId)).map(c => ({ content_id: c.id, line_id: c.lineId, kind: c.kind, text: translationText(c), ...(c.kind === 'timed' ? args.detail === 'full' ? { units: c.units.map(u => ({ unit_id: u.id, text: u.text, begin_ms: u.beginMs, end_ms: u.endMs })) } : { unit_count: c.units.length } : {}) })) })));
      if (args.track_ids?.some(value => !tracks.some(track => track.track_id === value))) invalid('A requested track does not exist for the selected kind.');
      return { revision: envelope.revision, total_lines: ordered.length, returned_lines: selected.length, tracks };
    },
  });
  registry.register({ name: 'edit_sublyrics', description: 'Atomically manage translation/romanization tracks, contents and timed units. content_kind explicitly selects plain/timed; use earlier client_ref values as IDs. Unspecified time endpoints keep their values; null clears them.', annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    inputSchema: { ...writeSchema, operations: z.array(operations).min(1) },
    execute: async (args, { client }) => mutateProjectDocument(client, args.project_id, { expectedRevision: args.expected_revision, idempotencyKey: args.idempotency_key }, (doc, envelope) => {
      let next = doc; const refs: Record<string, string> = Object.create(null), affectedTracks = new Set<string>(), affectedContents = new Set<string>();
      const resolve = (value: string) => reference(refs, value), anchor = (value: string | null) => value === null ? null : resolve(value);
      args.operations.forEach((op, index) => withOperationContext(op, index, envelope.revision, () => {
        const tracks: Array<TranslationTrack | RomanizationTrack> = structuredClone(op.kind === 'translation' ? next.lyrics.translationTracks : next.lyrics.romanizationTracks);
        if (op.op === 'create_track') {
          const track = { id: crypto.randomUUID(), language: op.language, contents: [], ...(op.kind === 'translation' ? { purpose: op.purpose } : {}) };
          remember(refs, op.client_ref, track.id); tracks.push(track); affectedTracks.add(track.id);
        } else {
          const target = op.track_id ?? op.track_ref; if (!target) invalid('Provide track_id or track_ref.');
          const track = tracks.find(track => track.id === resolve(target)) ?? invalid(`Track "${target}" does not exist.`);
          affectedTracks.add(track.id);
          if (op.op === 'update_track') { if (op.language !== undefined) track.language = op.language; if (op.purpose !== undefined) { if (op.kind !== 'translation') invalid('purpose applies to translation tracks.'); (track as TranslationTrack).purpose = op.purpose; } }
          else if (op.op === 'delete_track') tracks.splice(tracks.indexOf(track), 1);
          else if (op.op === 'move_track') { tracks.splice(tracks.indexOf(track), 1); tracks.splice(position(tracks, anchor(op.after_track_id)), 0, track); }
          else {
            const buildContent = (contentId: string, lineId: string, input: z.infer<typeof operations>): TranslationContent => {
              if (!('content_kind' in input)) invalid('content_kind is required.');
              if (input.content_kind === 'plain') { if (input.text === undefined || input.units !== undefined) invalid('plain content requires text and no units.'); return { id: contentId, lineId, kind: 'plain', text: input.text }; }
              if (input.units === undefined || input.text !== undefined) invalid('timed content requires units and no text.');
              return { id: contentId, lineId, kind: 'timed', units: input.units.map(u => { const id = crypto.randomUUID(); remember(refs, u.client_ref, id); return { id, text: u.text, beginMs: u.begin_ms ?? null, endMs: u.end_ms ?? null }; }) };
            };
            if (op.op === 'insert_content') {
              const lineId = resolve(op.line_id); if (!next.lyrics.lines.some(line => line.id === lineId)) invalid('Content line does not exist.');
              const contentId = crypto.randomUUID(); remember(refs, op.client_ref, contentId); affectedContents.add(contentId);
              const at = op.after_content_id === undefined ? track.contents.length : position(track.contents, anchor(op.after_content_id));
              track.contents.splice(at, 0, buildContent(contentId, lineId, op));
            } else {
              const c = track.contents.find(c => c.id === resolve(op.content_id)) ?? invalid(`Content "${op.content_id}" does not exist.`); affectedContents.add(c.id);
              if (op.op === 'update_content') track.contents[track.contents.indexOf(c)] = buildContent(c.id, c.lineId, op);
              else if (op.op === 'delete_content') track.contents.splice(track.contents.indexOf(c), 1);
              else if (op.op === 'move_content') {
                const dest = op.to_track_id ? tracks.find(t => t.id === resolve(op.to_track_id!)) ?? invalid('Destination track does not exist.') : track;
                c.lineId = resolve(op.line_id); track.contents.splice(track.contents.indexOf(c), 1); dest.contents.splice(position(dest.contents, anchor(op.after_content_id)), 0, c); affectedTracks.add(dest.id);
              } else {
                if (c.kind !== 'timed') invalid('Unit operations require timed content.');
                if (op.op === 'insert_unit') { const id = crypto.randomUUID(); remember(refs, op.client_ref, id); c.units.splice(position(c.units, anchor(op.after_unit_id)), 0, { id, text: op.text, beginMs: op.begin_ms ?? null, endMs: op.end_ms ?? null }); }
                else {
                  const u = c.units.find(u => u.id === resolve(op.unit_id)) ?? invalid('Timed unit does not exist.');
                  if (op.op === 'update_unit') { if (op.text !== undefined) u.text = op.text; if (op.begin_ms !== undefined) u.beginMs = op.begin_ms; if (op.end_ms !== undefined) u.endMs = op.end_ms; }
                  else if (op.op === 'delete_unit') c.units.splice(c.units.indexOf(u), 1);
                  else if (op.op === 'move_unit') { c.units.splice(c.units.indexOf(u), 1); c.units.splice(position(c.units, anchor(op.after_unit_id)), 0, u); }
                  else { const [left, right] = splitAtGrapheme(u.text, op.at), id = crypto.randomUUID(); remember(refs, op.client_ref, id); const middle = u.beginMs === null || u.endMs === null ? null : u.beginMs + Math.round((u.endMs - u.beginMs) * Array.from(left).length / Array.from(u.text).length); c.units.splice(c.units.indexOf(u), 1, { ...u, text: left, endMs: middle }, { ...u, id, text: right, beginMs: middle }); }
                }
              }
            }
          }
        }
        next = commitSublyricTracks(next, op.kind, tracks);
      }));
      return { nextDoc: next, summary: { created_refs: refs, affected_track_count: affectedTracks.size, affected_content_count: affectedContents.size } };
    }),
  });
}
