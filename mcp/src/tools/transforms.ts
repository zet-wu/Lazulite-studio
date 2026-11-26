import { z } from 'zod';
import { createProjectEditorState, type ProjectDocument } from '../../../frontend/src/domain/project-document';
import { lineText, type TranslationContent } from '../../../frontend/src/domain/lyric-document';
import { DEFAULT_SEGMENT_OPTIONS, segmentationPreview, distributeSegmentTime, loadSyllableDivider, type SegmentOptions } from '../../../frontend/src/domain/segmentation';
import { splitReadingMora } from '../../../frontend/src/domain/ruby-editing';
import { proposeRomanization, romanizationGenerationCommand, hasGeneratedContent, type ParticleRange } from '../../../frontend/src/domain/romanization-generation';
import { rubySourceRows, proposeRuby, defaultRubySkips, rubyGenerationIssues, rubyGenerationCommand } from '../../../frontend/src/domain/ruby-generation';
import { replaceText, clearRuby, shiftLineTimes, smoothWordTimes, syncLineTimes } from '../../../frontend/src/domain/batch-editing';
import type { LyricCommand } from '../../../frontend/src/domain/lyric-commands';
import { mutateProjectDocument } from './cas';
import { applySplitAndSetWord } from './reading';
import { id, time, writeSchema, invalid, run } from './editing';
import type { ToolRegistry } from './registry';

const transformSchema = () => ({ ...writeSchema(), dry_run: z.boolean().default(true) });
const scopeSchema = () => z.object({ all: z.boolean().optional(), line_ids: z.array(id()).min(1).optional(), word_ids: z.array(id()).min(1).optional(), include_background: z.boolean().default(true) });
type Scope = z.infer<ReturnType<typeof scopeSchema>>;
function select(doc: ProjectDocument, scope: Scope) {
  if (!scope.all && !scope.line_ids && !scope.word_ids) invalid('Scope requires all=true, line_ids, or word_ids.');
  if (scope.all && (scope.line_ids || scope.word_ids)) invalid('Scope all cannot be combined with ID filters.');
  if (scope.line_ids?.some(id => !doc.lyrics.lines.some(l => l.id === id))) invalid('A scope line does not exist.');
  if (scope.word_ids?.some(id => !doc.lyrics.lines.some(l => l.words.some(w => w.id === id)))) invalid('A scope word does not exist.');
  return doc.lyrics.lines.filter(line => scope.include_background || !line.backgroundOf).flatMap(line => line.words.filter(word => scope.all || (!scope.line_ids || scope.line_ids.includes(line.id)) && (!scope.word_ids || scope.word_ids.includes(word.id))).map(word => ({ line, word })));
}
const optionsSchema = () => z.object({ split_cjk: z.boolean().optional(), japanese_mora: z.boolean().optional(), western: z.enum(['word','syllable']).optional(), language: z.enum(['en-us','de','fr','es','id','it','pt','ru']).optional(), punctuation: z.enum(['merge','separate']).optional(), whitespace: z.enum(['separate','previous','next']).optional(), punctuation_weight: z.number().nonnegative().optional(), ignore: z.array(z.string()).optional(), rules: z.array(z.object({ source: id(), parts: z.array(id()).min(2) })).optional() });
const annotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: false };

function batchAffectedLines(before: ProjectDocument, after: ProjectDocument): string[] {
  const lineStates = (doc: ProjectDocument) => {
    const states = new Map(doc.lyrics.lines.map(line => [line.id, {
      line,
      emptyBeats: Object.fromEntries(line.words.flatMap(word => [word.id, ...word.rubyUnits.map(unit => unit.id)])
        .filter(id => doc.editing.emptyBeats[id]).map(id => [id, doc.editing.emptyBeats[id]])),
      translations: [] as TranslationContent[],
      romanizations: [] as TranslationContent[],
    }]));
    for (const track of doc.lyrics.translationTracks) for (const content of track.contents) states.get(content.lineId)!.translations.push(content);
    for (const track of doc.lyrics.romanizationTracks) for (const content of track.contents) states.get(content.lineId)!.romanizations.push(content);
    return new Map([...states].map(([id, state]) => [id, JSON.stringify(state)]));
  };
  const previous = lineStates(before), next = lineStates(after);
  return [...new Set([...previous.keys(), ...next.keys()])].filter(id => previous.get(id) !== next.get(id));
}

export function registerTransformTools(registry: ToolRegistry) {
  registry.register({ name: 'segment_lyrics', description: 'Preview/apply shared desktop body-word segmentation or ruby mora splits. Default workflow: body first, then readings, then ruby mora. Japanese kana/okurigana must split from kanji (split_cjk=true,japanese_mora=true); Chinese body uses single characters; Western text uses western=word. Splitting ruby alone does not split body. dry_run defaults to true. Existing ruby words are skipped by default while other body words continue; skip_existing_ruby=false reports them as blocked, allow_overwrite_ruby=true explicitly replaces them. Scope is explicit; summary omits per-word previews.', annotations,
    inputSchema: { ...transformSchema(), target: z.enum(['words','ruby']), scope: scopeSchema(), options: optionsSchema().default({}), allow_overwrite_ruby: z.boolean().default(false), skip_existing_ruby: z.boolean().default(true), detail: z.enum(['summary','full']).default('full') },
    execute: async (args, { client }) => mutateProjectDocument(client, args.project_id, { expectedRevision: args.expected_revision, idempotencyKey: args.idempotency_key, dryRun: args.dry_run }, async (doc, envelope) => {
      const options: SegmentOptions = {
        splitCjk: args.options.split_cjk ?? DEFAULT_SEGMENT_OPTIONS.splitCjk,
        japaneseMora: args.options.japanese_mora ?? DEFAULT_SEGMENT_OPTIONS.japaneseMora,
        western: args.options.western ?? DEFAULT_SEGMENT_OPTIONS.western,
        language: args.options.language ?? DEFAULT_SEGMENT_OPTIONS.language,
        punctuation: args.options.punctuation ?? DEFAULT_SEGMENT_OPTIONS.punctuation,
        whitespace: args.options.whitespace ?? DEFAULT_SEGMENT_OPTIONS.whitespace,
        punctuationWeight: args.options.punctuation_weight ?? DEFAULT_SEGMENT_OPTIONS.punctuationWeight,
        ignore: args.options.ignore ?? DEFAULT_SEGMENT_OPTIONS.ignore,
        rules: args.options.rules ?? DEFAULT_SEGMENT_OPTIONS.rules,
      };
      const divider = options.western === 'syllable' ? await loadSyllableDivider(options.language) : undefined;
      const targets = select(doc, args.scope); let next = doc, changed = 0, blocked = 0, skipped = 0, skippedRuby = 0;
      const preview: Array<Record<string, unknown>> = [];
      for (const { line, word } of targets) {
        if (args.target === 'words') {
          if (word.rubyUnits.length && !args.allow_overwrite_ruby && args.skip_existing_ruby) { skippedRuby++; preview.push({line_id:line.id,word_id:word.id,skipped:'existing_ruby'}); continue; }
          const entry = segmentationPreview(doc.lyrics, [word.id], options, divider, doc.editing)[0];
          if (entry.parts.length < 2) { skipped++; continue; }
          const reason = word.obscene ? 'obscene_word' : word.rubyUnits.length ? args.allow_overwrite_ruby ? null : 'existing_ruby' : entry.blocked ? 'empty_beats' : null;
          preview.push({ line_id: line.id, word_id: word.id, before: word.text, after: entry.parts, blocked: reason });
          if (reason) { blocked++; continue; }
          next = word.rubyUnits.length ? applySplitAndSetWord(createProjectEditorState(next), line.id, word.id, entry.parts.map(text => ({ text, readings: [] })), true).present
            : run(next, { type: 'segment-word', lineId: line.id, wordId: word.id, words: distributeSegmentTime(word, entry.parts, options.punctuationWeight) });
          changed++;
        } else {
          const commands: Exclude<LyricCommand, { type: 'batch' }>[] = [];
          const after = word.rubyUnits.flatMap(unit => {
            const parts = splitReadingMora(unit.reading); let offset = 0;
            for (const part of parts.slice(0,-1)) { offset += Array.from(part).length; }
            for (let index = parts.length - 1; index > 0; index--) { commands.push({ type: 'split-ruby', lineId: line.id, wordId: word.id, rubyId: unit.id, at: offset }); offset -= Array.from(parts[index - 1]).length; }
            return parts;
          });
          if (!commands.length) { skipped++; continue; }
          preview.push({ line_id: line.id, word_id: word.id, before: word.rubyUnits.map(u => u.reading), after });
          next = run(next, { type: 'batch', commands }); changed++;
        }
      }
      return { nextDoc: next, summary: { dry_run: args.dry_run, revision: envelope.revision, changed_count: changed, blocked_count: blocked, skipped_count: skipped, skipped_existing_ruby_count: skippedRuby, ...(args.detail === 'full' ? { preview } : {}) } };
    }),
  });
  registry.register({ name: 'generate_romanization', description: 'Preview/apply Japanese romanization using shared desktop generation, optional backend particle normalization, and explicit per-line conflict decisions. Defaults to dry_run=true and skip existing content. Review proposals, then supply line_decisions.override_units (timed) or override_text (plain); reread unit IDs after replacement.', annotations,
    inputSchema: { ...transformSchema(), line_ids: z.array(id()).min(1).optional(), include_background: z.boolean().default(true), kind: z.enum(['plain','timed']).default('timed'), convert_particles: z.boolean().default(true), target_track_id: id().optional(), language: z.string().default('ja-Latn'), default_conflict_policy: z.enum(['skip','append','replace']).default('skip'), line_decisions: z.array(z.object({ line_id: id(), action: z.enum(['skip','append','replace']), replace_content_id: id().optional(), override_text: z.string().optional(), override_units: z.array(z.object({ text: id(), begin_ms: time().optional(), end_ms: time().optional() })).optional() })).default([]) },
    execute: async (args, { client }) => mutateProjectDocument(client, args.project_id, { expectedRevision: args.expected_revision, idempotencyKey: args.idempotency_key, dryRun: args.dry_run }, async (doc, envelope) => {
      if (args.line_ids?.some(id => !doc.lyrics.lines.some(l => l.id === id))) invalid('A requested line does not exist.');
      const lines = doc.lyrics.lines.filter(line => (!args.line_ids || args.line_ids.includes(line.id)) && (args.include_background || !line.backgroundOf));
      const track = args.target_track_id ? doc.lyrics.romanizationTracks.find(t => t.id === args.target_track_id) ?? invalid('Target romanization track does not exist.') : null;
      const particles = args.convert_particles ? (await client.json<{ ranges: ParticleRange[] }>('/reading/particles', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lines: lines.map(line => ({ id: line.id, text: lineText(line) })) }) })).ranges : [];
      const rows = proposeRomanization(doc.lyrics, lines.map(line => line.id), args.kind, particles);
      const decisions = new Map(args.line_decisions.map(d => [d.line_id,d]));
      if (decisions.size !== args.line_decisions.length || args.line_decisions.some(d => !lines.some(line => line.id === d.line_id))) invalid('Line decisions must uniquely refer to selected lines.');
      const conflicts: Array<{ line_id: string; existing_content_ids: string[] }> = [];
      const targets: Record<string,string> = {};
      for (const row of rows) {
        const decision = decisions.get(row.lineId), existing = track?.contents.filter(c => c.lineId === row.lineId) ?? [];
        if (existing.length) conflicts.push({ line_id: row.lineId, existing_content_ids: existing.map(c => c.id) });
        const action = decision?.action ?? (existing.length ? args.default_conflict_policy : 'append');
        if (action === 'replace') {
          if (!decision?.replace_content_id && existing.length !== 1) invalid('Replace requires replace_content_id when the line has zero or multiple contents.');
          targets[row.lineId] = decision?.replace_content_id ?? existing[0].id;
        } else targets[row.lineId] = action;
        if (decision?.override_text !== undefined) { if (row.kind !== 'plain') invalid('override_text requires plain kind.'); row.text = decision.override_text; }
        if (decision?.override_units !== undefined) { if (row.kind !== 'timed') invalid('override_units requires timed kind.'); row.groups = decision.override_units.map((u,index) => ({ key: `override-${index}`, wordId: '', text: u.text, beginMs: u.begin_ms ?? null, endMs: u.end_ms ?? null, hint: '' })); }
      }
      const active = rows.filter(row => targets[row.lineId] !== 'skip' && hasGeneratedContent(row));
      let next = doc;
      if (active.length) {
        const source = track && track.language !== 'ja-Latn' ? { ...doc.lyrics, romanizationTracks: doc.lyrics.romanizationTracks.map(t => t.id === track.id ? { ...t, language: 'ja-Latn' } : t) } : doc.lyrics;
        next = run(doc, romanizationGenerationCommand(source, source, rows, { trackId: track?.id ?? null, targets }));
        if (!track && args.language !== 'ja-Latn') next = run(next, { type: 'set-romanization-track-language', trackId: next.lyrics.romanizationTracks.at(-1)!.id, language: args.language });
      }
      return { nextDoc: next, summary: { dry_run: args.dry_run, revision: envelope.revision, changed_count: active.length, proposals: rows, conflicts, hints: rows.flatMap(row => row.kind === 'plain' ? row.hint ? [{ line_id: row.lineId, hint: row.hint }] : [] : row.groups.filter(u => u.hint).map(u => ({ line_id: row.lineId, unit_key: u.key, hint: u.hint }))) } };
    }),
  });
  registry.register({ name: 'generate_ruby_from_romanization', description: 'Preview/apply reverse ruby generation with shared candidate matching and target/reading/overwrite/kana-difference issues. Resolve blocking issues through assignments/readings/skip_keys/overwrite_word_ids before applying. Review dry_run candidates, then pass readings and assignments keyed by candidate row key.', annotations,
    inputSchema: { ...transformSchema(), track_id: id(), content_ids: z.array(id()).min(1).optional(), output: z.enum(['roman','hiragana','katakana']).default('hiragana'), assignments: z.record(id().nullable()).default({}), readings: z.record(z.string()).default({}), skip_keys: z.array(id()).default([]), overwrite_word_ids: z.array(id()).default([]) },
    execute: async (args, { client }) => mutateProjectDocument(client, args.project_id, { expectedRevision: args.expected_revision, idempotencyKey: args.idempotency_key, dryRun: args.dry_run }, (doc, envelope) => {
      const track = doc.lyrics.romanizationTracks.find(t => t.id === args.track_id) ?? invalid('Source romanization track does not exist.');
      const rows = proposeRuby(rubySourceRows(doc.lyrics, track.id, args.content_ids ?? track.contents.map(c => c.id)), args.output, args.assignments);
      const keys = new Set(rows.map(row => row.key));
      if ([...Object.keys(args.assignments),...Object.keys(args.readings),...args.skip_keys].some(key => !keys.has(key))) invalid('A supplied row key does not exist in this selection.');
      const skipped = new Set([...defaultRubySkips(doc.lyrics, rows, args.output, args.readings),...args.skip_keys]);
      const overwrite = new Set(args.overwrite_word_ids), issues = rubyGenerationIssues(doc.lyrics, rows, args.readings, skipped, overwrite, args.output, doc.editing);
      const active = rows.filter(row => !skipped.has(row.key));
      let next = doc;
      if (!args.dry_run && issues.some(issue => issue.severity === 'error')) invalid('Ruby generation has blocking issues; inspect the dry_run issues and supply decisions.');
      if (active.length && !issues.some(issue => issue.severity === 'error')) next = run(doc, rubyGenerationCommand(doc.lyrics, doc.lyrics, rows, args.readings, skipped, overwrite, doc.editing));
      return { nextDoc: next, summary: { dry_run: args.dry_run, revision: envelope.revision, candidates: rows, issues, skipped_keys: [...skipped], changed_count: next === doc ? 0 : active.length } };
    }),
  });
  registry.register({ name: 'batch_edit_lyrics', description: 'Preview/apply shared desktop batch replacement, ruby clearing, and time shift/smoothing/sync. dry_run defaults to true. Time operations use selected lines; partial word scope is rejected for them.', annotations,
    inputSchema: { ...transformSchema(), scope: scopeSchema(), action: z.discriminatedUnion('type', [
      z.object({ type: z.literal('replace'), kind: z.enum(['words','ruby']), search: id(), replacement: z.string(), ignore_case: z.boolean().default(false) }),
      z.object({ type: z.literal('clear_ruby') }), z.object({ type: z.literal('shift'), delta_ms: z.number().int() }), z.object({ type: z.literal('smooth'), threshold_ms: z.number().int().nonnegative() }), z.object({ type: z.literal('sync') }),
    ]) },
    execute: async (args, { client }) => mutateProjectDocument(client, args.project_id, { expectedRevision: args.expected_revision, idempotencyKey: args.idempotency_key, dryRun: args.dry_run }, (doc, envelope) => {
      const targets = select(doc, args.scope), wordIds = targets.map(t => t.word.id);
      const lineIds = doc.lyrics.lines.filter(line => (args.scope.include_background || !line.backgroundOf) && (args.scope.all || args.scope.line_ids?.includes(line.id) || targets.some(t => t.line.id === line.id))).map(line => line.id);
      if (args.scope.word_ids && ['shift','smooth','sync'].includes(args.action.type)) invalid('Time batch operations require line scope.');
      let command: LyricCommand, hits = 0, deletedWords = 0, deletedRuby = 0, deletedBeats = 0;
      const action = args.action;
      switch (action.type) {
        case 'replace': { const result = replaceText(doc.lyrics, action.kind === 'words' ? wordIds : targets.flatMap(t => t.word.rubyUnits.map(u => u.id)), action.kind, action.search, action.replacement, action.ignore_case, doc.editing); command = result.command; hits = result.count; deletedWords = result.deletedWords; deletedRuby = result.deletedRuby; deletedBeats = result.deletedBeats; break; }
        case 'clear_ruby': { const result = clearRuby(doc.lyrics, wordIds, doc.editing); command = result.command; hits = result.words; deletedRuby = result.ruby; deletedBeats = result.beats; break; }
        case 'shift': command = shiftLineTimes(doc.lyrics, lineIds, action.delta_ms, doc.editing); hits = lineIds.length; break;
        case 'smooth': { const result = smoothWordTimes(doc.lyrics, lineIds, action.threshold_ms); command = result.command; hits = result.count; break; }
        case 'sync': command = syncLineTimes(doc.lyrics, lineIds); hits = lineIds.length; break;
      }
      let next = run(doc, command);
      const changedLines = batchAffectedLines(doc, next);
      if (JSON.stringify(next) === JSON.stringify(doc)) next = doc;
      return { nextDoc: next, summary: { dry_run: args.dry_run, revision: envelope.revision, hit_count: hits, changed_count: changedLines.length, deleted_words: deletedWords, deleted_ruby: deletedRuby, deleted_beats: deletedBeats, affected_lines: changedLines, invalidates_alignment: next !== doc } };
    }),
  });
}
