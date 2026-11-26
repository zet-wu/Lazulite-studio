import { z } from 'zod';
import { timeEnvelope, type LyricCommand } from '../../../frontend/src/domain/lyric-commands';
import { id, time, writeSchema, invalid, requireLine, requireWord, run } from './editing';
import { commitSublyricTracks } from './sublyrics';
import { mutateProjectDocument } from './cas';
import { withOperationContext, type ToolRegistry } from './registry';
const endpoints = () => ({ begin_ms: time().optional(), end_ms: time().optional() });
const operation = z.discriminatedUnion('op', [
  z.object({op:z.literal('clear_line_timing'),line_id:id()}),
  z.object({op:z.literal('clear_word_timing'),line_id:id(),word_id:id()}),
  z.object({ op: z.literal('set_line_time'), line_id: id(), ...endpoints() }),
  z.object({ op: z.literal('set_word_time'), line_id: id(), word_id: id(), ...endpoints() }),
  z.object({ op: z.literal('set_ruby_time'), line_id: id(), word_id: id(), ruby_id: id(), ...endpoints() }),
  z.object({ op: z.literal('set_sublyric_unit_time'), kind: z.enum(['translation','romanization']), track_id: id(), content_id: id(), unit_id: id(), ...endpoints() }),
  z.object({ op: z.literal('set_empty_beat'), target_kind: z.enum(['word','ruby']), target_id: id(), count: z.number().int().min(0).max(32) }),
]);
export function registerTimingTools(registry: ToolRegistry) {
  registry.register({ name: 'edit_timing', description: 'Atomically edit nullable lyric timing endpoints and empty beats. Omitted endpoints remain unchanged. Word/ruby edits recompute parent envelopes by default using the same domain commands as the desktop editor.', annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    inputSchema: { ...writeSchema(), recompute_envelopes: z.boolean().default(true), operations: z.array(operation).min(1) },
    execute: async (args, { client }) => mutateProjectDocument(client, args.project_id, { expectedRevision: args.expected_revision, idempotencyKey: args.idempotency_key }, (doc, envelope) => {
      let next = doc; const affected = new Set<string>();
      args.operations.forEach((op, index) => withOperationContext(op, index, envelope.revision, () => {
        if (op.op === 'set_empty_beat') { next = run(next, { type: 'set-empty-beat', kind: op.target_kind, id: op.target_id, count: op.count }); return; }
        if (op.op === 'set_sublyric_unit_time') {
          const tracks = structuredClone(op.kind === 'translation' ? next.lyrics.translationTracks : next.lyrics.romanizationTracks);
          const track = tracks.find(t => t.id === op.track_id) ?? invalid('Track does not exist.');
          const content = track.contents.find(c => c.id === op.content_id); if (content?.kind !== 'timed') invalid('Timed content does not exist.');
          const unit = content.units.find(u => u.id === op.unit_id) ?? invalid('Timed unit does not exist.');
          if (op.begin_ms !== undefined) unit.beginMs = op.begin_ms; if (op.end_ms !== undefined) unit.endMs = op.end_ms;
          next = commitSublyricTracks(next, op.kind, tracks); affected.add(content.lineId); return;
        }
        const line = requireLine(next, op.line_id); affected.add(line.id);
        if (op.op === 'clear_line_timing' || op.op === 'clear_word_timing') {
          const words=op.op==='clear_line_timing'?line.words:[requireWord(next,line.id,op.word_id)];
          const commands: Exclude<LyricCommand,{type:'batch'}>[] = words.flatMap(word=>[
            ...word.rubyUnits.map(unit=>({type:'set-ruby-time' as const,lineId:line.id,wordId:word.id,rubyId:unit.id,beginMs:null,endMs:null})),
            {type:'set-word-time' as const,lineId:line.id,wordId:word.id,beginMs:null,endMs:null},
          ]);
          if(op.op==='clear_line_timing')commands.push({type:'set-line-time',lineId:line.id,beginMs:null,endMs:null});
          else if(args.recompute_envelopes) commands.push({type:'set-line-time',lineId:line.id,...timeEnvelope(line.words.filter(word=>word.id!==op.word_id))});
          next=run(next,{type:'batch',commands});return;
        }
        if (op.op === 'set_line_time') { next = run(next, { type: 'set-line-time', lineId: line.id, beginMs: op.begin_ms === undefined ? line.beginMs : op.begin_ms, endMs: op.end_ms === undefined ? line.endMs : op.end_ms }); return; }
        const word = requireWord(next, line.id, op.word_id);
        const unit = op.op === 'set_ruby_time' ? word.rubyUnits.find(u => u.id === op.ruby_id) ?? invalid('Ruby unit does not exist.') : word;
        const times = { beginMs: op.begin_ms === undefined ? unit.beginMs : op.begin_ms, endMs: op.end_ms === undefined ? unit.endMs : op.end_ms };
        const target = op.op === 'set_ruby_time' ? { ...word, rubyUnits: word.rubyUnits.map(u => u.id === op.ruby_id ? { ...u, ...times } : u) } : { ...word, ...times };
        const wordTimes = op.op === 'set_ruby_time' && args.recompute_envelopes ? timeEnvelope(target.rubyUnits) : op.op === 'set_word_time' ? times : word;
        const lineTimes = timeEnvelope(line.words.map(w => w.id === word.id ? { ...w, ...wordTimes } : w));
        const commands: Exclude<LyricCommand, { type: 'batch' }>[] = [];
        if (args.recompute_envelopes) {
          commands.push({ type: 'set-line-time', lineId: line.id, ...timeEnvelope([line, lineTimes]) });
          if (op.op === 'set_ruby_time') commands.push({ type: 'set-word-time', lineId: line.id, wordId: word.id, ...timeEnvelope([word, wordTimes]) });
        }
        commands.push(op.op === 'set_word_time' ? { type: 'set-word-time', lineId: line.id, wordId: word.id, ...times } : { type: 'set-ruby-time', lineId: line.id, wordId: word.id, rubyId: op.ruby_id, ...times });
        if (!args.recompute_envelopes && op.op === 'set_ruby_time') commands.push({ type: 'set-word-time', lineId: line.id, wordId: word.id, beginMs: word.beginMs, endMs: word.endMs });
        if (args.recompute_envelopes) {
          if (op.op === 'set_ruby_time') commands.push({ type: 'set-word-time', lineId: line.id, wordId: word.id, beginMs: wordTimes.beginMs, endMs: wordTimes.endMs });
          commands.push({ type: 'set-line-time', lineId: line.id, ...lineTimes });
        }
        next = run(next, { type: 'batch', commands });
      }));
      return { nextDoc: next, summary: { affected_line_ids: [...affected], operations_applied: args.operations.length } };
    }),
  });
}
