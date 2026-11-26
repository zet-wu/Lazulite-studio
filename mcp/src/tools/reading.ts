import { z } from 'zod';
import { parseProject } from '../../../frontend/src/adapters/project-codec';
import { displayLines, sameAgents, wordAgents } from '../../../frontend/src/domain/amll-compatibility';
import {
  emptyBeatCount,
  type ProjectEditing,
} from '../../../frontend/src/domain/project-editing';
import { timeEnvelope, type LyricCommand } from '../../../frontend/src/domain/lyric-commands';

type AtomicLyricCommand = Exclude<LyricCommand, { type: 'batch' }>;
import {
  lineText,
  type LyricDocument,
  type LyricLine,
  type LyricWord,
  type RubyUnit,
  type TimeMs,
} from '../../../frontend/src/domain/lyric-document';
import {
  createProjectEditorState,
  executeProjectCommand,
  type ProjectDocument,
  type ProjectEditorState,
} from '../../../frontend/src/domain/project-document';
import { distributeRubyTime } from '../../../frontend/src/domain/ruby-editing';
import { StudioHttpError } from '../client';
import { mutateProjectDocument } from './cas';
import { withOperationContext, type ToolRegistry } from './registry';

const nonEmptyReadingSchema = () => z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0, 'Reading string must not be whitespace-only.');

const SetWordOperationSchema = z.object({
  mode: z.literal('set_word'),
  line_id: z.string().min(1).describe('Target line ID.'),
  word_id: z.string().min(1).describe('Target word ID within the line.'),
  readings: z
    .array(nonEmptyReadingSchema())
    .describe('Ruby unit readings for this word (e.g. ["きょう"] or ["あ","し","た"]), or [] to clear ruby units.'),
});

const SplitAndSetWordOperationSchema = z.object({
  mode: z.literal('split_and_set_word'),
  line_id: z.string().min(1).describe('Target line ID.'),
  word_id: z.string().min(1).describe('Target word ID to split.'),
  parts: z
    .array(
      z.object({
        text: z.string().min(1).describe('Surface text slice of the split word.'),
        readings: z.array(nonEmptyReadingSchema()).default([]).describe('Ruby units for this part ([] for none).'),
      }),
    )
    .min(2)
    .describe('Consecutive parts whose concatenated text equals the original word text.'),
});

const MergeWordsOperationSchema = z.object({
  mode: z.literal('merge_words'),
  line_id: z.string().min(1).describe('Target line ID.'),
  word_ids: z
    .array(z.string().min(1))
    .min(2)
    .describe('Consecutive compatible word IDs in the same line to merge into one word.'),
  readings: z
    .array(nonEmptyReadingSchema())
    .optional()
    .describe('Optional ruby units for the merged word. When omitted, existing ruby units from merged words are kept.'),
});

const LineSpanSchema = z.object({
  base_start: z.number().int().min(0).describe('Inclusive start Unicode code-point offset in line text.'),
  base_end: z.number().int().min(1).describe('Exclusive end Unicode code-point offset in line text.'),
  base: z.string().min(1).optional().describe('Optional expected substring at [base_start, base_end) for verification.'),
  readings: z
    .array(nonEmptyReadingSchema())
    .describe('Ruby unit readings for this span (e.g. ["あした"] or ["あ","し","た"]), or [] to clear ruby units.'),
});

const SetLineSpansOperationSchema = z.object({
  mode: z.literal('set_line_spans'),
  line_id: z.string().min(1).describe('Target line ID.'),
  spans: z
    .array(LineSpanSchema)
    .min(1)
    .describe(
      'Non-overlapping target spans in the line. Automatically splits existing words or merges consecutive compatible words covering each span while preserving timestamps.',
    ),
});

const ReadingOperationSchema = z.discriminatedUnion('mode', [
  SetWordOperationSchema,
  SplitAndSetWordOperationSchema,
  MergeWordsOperationSchema,
  SetLineSpansOperationSchema,
]);

function validationError(code: string, message: string): StudioHttpError {
  return new StudioHttpError(422, { code, message, retryable: false });
}

function selectTargetLines(
  doc: ProjectDocument,
  lineIds: string[] | undefined,
  startLine: number,
  limit: number,
): { totalLines: number; selected: Array<{ line: LyricLine; lineNumber: number }> } {
  const ordered = displayLines(doc.lyrics, doc.lineOrder);
  if (lineIds?.length) {
    const numberById = new Map(ordered.map((line, index) => [line.id, index + 1]));
    const byId = new Map(ordered.map((line) => [line.id, line]));
    const selected = lineIds.map((id) => {
      const line = byId.get(id);
      if (!line) {
        throw validationError('line_not_found', `Line "${id}" does not exist in project.`);
      }
      return { line, lineNumber: numberById.get(id)! };
    });
    return { totalLines: ordered.length, selected };
  }

  const startIndex = startLine - 1;
  const slice = ordered.slice(startIndex, startIndex + limit);
  return {
    totalLines: ordered.length,
    selected: slice.map((line, offset) => ({ line, lineNumber: startIndex + offset + 1 })),
  };
}

function summarizeWord(word: LyricWord) {
  return {
    word_id: word.id,
    text: word.text,
    begin_ms: word.beginMs,
    end_ms: word.endMs,
    ruby: word.rubyUnits.map((unit) => unit.reading),
  };
}

function wordTimeEnvelope(word: LyricWord): { beginMs: TimeMs; endMs: TimeMs } {
  if (word.beginMs !== null && word.endMs !== null) {
    return { beginMs: word.beginMs, endMs: word.endMs };
  }
  const envelope = timeEnvelope(word.rubyUnits);
  return {
    beginMs: word.beginMs ?? envelope.beginMs,
    endMs: word.endMs ?? envelope.endMs,
  };
}

function distributeSubPartTimes(
  word: LyricWord,
  partCharLengths: number[],
): Array<{ beginMs: TimeMs; endMs: TimeMs }> {
  const { beginMs, endMs } = wordTimeEnvelope(word);
  const totalChars = partCharLengths.reduce((sum, len) => sum + len, 0);
  const boundary = (pos: number): TimeMs => {
    if (pos === 0) return beginMs;
    if (pos === totalChars) return endMs;
    if (beginMs === null || endMs === null) return null;
    return beginMs + Math.round(((endMs - beginMs) * pos) / totalChars);
  };
  let offset = 0;
  return partCharLengths.map((len) => {
    const start = boundary(offset);
    offset += len;
    const end = boundary(offset);
    return { beginMs: start, endMs: end };
  });
}

function buildRubyUnits(word: LyricWord, existingUnits: RubyUnit[], readings: string[]): RubyUnit[] {
  const envelope = wordTimeEnvelope({ ...word, rubyUnits: existingUnits });
  const rawUnits: RubyUnit[] = readings.map((reading, index) => ({
    id: index < existingUnits.length ? existingUnits[index].id : crypto.randomUUID(),
    reading,
    beginMs: null,
    endMs: null,
  }));
  return distributeRubyTime({ ...word, ...envelope }, rawUnits);
}

function getLineOrThrow(lyrics: LyricDocument, lineId: string): LyricLine {
  const line = lyrics.lines.find((item) => item.id === lineId);
  if (!line) throw validationError('line_not_found', `Line "${lineId}" does not exist.`);
  return line;
}

function getWordOrThrow(line: LyricLine, wordId: string): LyricWord {
  const word = line.words.find((item) => item.id === wordId);
  if (!word) {
    throw validationError('word_not_found', `Word "${wordId}" does not exist in line "${line.id}".`);
  }
  return word;
}

function runCommand(state: ProjectEditorState, command: AtomicLyricCommand | { type: 'batch'; commands: AtomicLyricCommand[] }): ProjectEditorState {
  return executeProjectCommand(state, { type: 'lyrics', command });
}

function clearAndCollectOldBeats(word: LyricWord, editing: ProjectEditing): {
  clearCommands: AtomicLyricCommand[];
  preservedBeat: number;
} {
  const clearCommands: AtomicLyricCommand[] = [];
  const wordBeat = emptyBeatCount(editing, word.id);
  if (wordBeat > 0) {
    clearCommands.push({ type: 'set-empty-beat', kind: 'word', id: word.id, count: 0 });
  }
  let rubyBeat = 0;
  for (const unit of word.rubyUnits) {
    const count = emptyBeatCount(editing, unit.id);
    if (count > 0) {
      if (!rubyBeat) rubyBeat = count;
      clearCommands.push({ type: 'set-empty-beat', kind: 'ruby', id: unit.id, count: 0 });
    }
  }
  return { clearCommands, preservedBeat: wordBeat || rubyBeat };
}

function applySetWord(
  state: ProjectEditorState,
  lineId: string,
  wordId: string,
  readings: string[],
  overwriteExisting: boolean,
): ProjectEditorState {
  const line = getLineOrThrow(state.present.lyrics, lineId);
  const word = getWordOrThrow(line, wordId);

  if (!overwriteExisting && word.rubyUnits.length > 0) {
    throw validationError(
      'ruby_overwrite_blocked',
      `Word "${word.text}" (${word.id}) already has ruby units. Set overwrite_existing=true to replace.`,
    );
  }

  if (readings.length === 0) {
    if (word.rubyUnits.length === 0) return state;
    const commands: AtomicLyricCommand[] = word.rubyUnits.map((unit) => ({
      type: 'delete-ruby',
      lineId,
      wordId,
      rubyId: unit.id,
    }));
    return runCommand(state, commands.length === 1 ? commands[0] : { type: 'batch', commands });
  }

  const nextUnits = buildRubyUnits(word, word.rubyUnits, readings);
  const droppedUnitIds = word.rubyUnits
    .slice(nextUnits.length)
    .filter((unit) => emptyBeatCount(state.present.editing, unit.id) > 0)
    .map((unit) => unit.id);

  const commands: AtomicLyricCommand[] = [
    ...droppedUnitIds.map(
      (id): AtomicLyricCommand => ({ type: 'set-empty-beat', kind: 'ruby', id, count: 0 }),
    ),
    { type: 'set-ruby-units', lineId, wordId, units: nextUnits, overwrite: true },
  ];
  return runCommand(state, commands.length === 1 ? commands[0] : { type: 'batch', commands });
}

export function applySplitAndSetWord(
  state: ProjectEditorState,
  lineId: string,
  wordId: string,
  parts: Array<{ text: string; readings: string[] }>,
  overwriteExisting: boolean,
): ProjectEditorState {
  const line = getLineOrThrow(state.present.lyrics, lineId);
  const word = getWordOrThrow(line, wordId);

  if (parts.map((part) => part.text).join('') !== word.text) {
    throw validationError(
      'split_text_mismatch',
      `Split parts text "${parts.map((part) => part.text).join('')}" does not match word text "${word.text}".`,
    );
  }
  if (word.obscene) {
    throw validationError('split_obscene_word', `Cannot split obscene word "${word.text}".`);
  }
  if (!overwriteExisting && word.rubyUnits.length > 0) {
    throw validationError(
      'ruby_overwrite_blocked',
      `Word "${word.text}" (${word.id}) already has ruby units. Set overwrite_existing=true to split and replace.`,
    );
  }

  const partTimes = distributeSubPartTimes(
    word,
    parts.map((part) => Array.from(part.text).length),
  );

  const { clearCommands, preservedBeat } = clearAndCollectOldBeats(word, state.present.editing);

  const segmentWords: LyricWord[] = parts.map((part, index) => {
    const subWord: LyricWord = {
      id: index === 0 ? word.id : crypto.randomUUID(),
      text: part.text,
      beginMs: partTimes[index].beginMs,
      endMs: partTimes[index].endMs,
      obscene: false,
      rubyUnits: [],
      ...(word.agentRefs ? { agentRefs: [...word.agentRefs] } : {}),
    };

    return subWord;
  });

  const rubyCommands: AtomicLyricCommand[] = segmentWords.flatMap((part, index) => parts[index].readings.length
    ? [{ type: 'set-ruby-units' as const, lineId, wordId: part.id, units: buildRubyUnits(part, [], parts[index].readings), overwrite: true }] : []);
  const restoreCommands: AtomicLyricCommand[] = [];
  if (preservedBeat > 0) {
    const first = segmentWords[0];
    const firstRuby = rubyCommands.find(command => command.type === 'set-ruby-units' && command.wordId === first.id);
    if (firstRuby?.type === 'set-ruby-units') {
      restoreCommands.push({
        type: 'set-empty-beat',
        kind: 'ruby',
        id: firstRuby.units[0].id,
        count: preservedBeat,
      });
    } else {
      restoreCommands.push({
        type: 'set-empty-beat',
        kind: 'word',
        id: first.id,
        count: preservedBeat,
      });
    }
  }

  const commands: AtomicLyricCommand[] = [
    ...clearCommands,
    ...word.rubyUnits.map(unit => ({ type: 'delete-ruby' as const, lineId, wordId, rubyId: unit.id })),
    { type: 'set-word-time', lineId, wordId, ...wordTimeEnvelope(word) },
    { type: 'segment-word', lineId, wordId, words: segmentWords },
    ...rubyCommands,
    ...restoreCommands,
  ];
  return runCommand(state, commands.length === 1 ? commands[0] : { type: 'batch', commands });
}

function applyMergeWords(
  state: ProjectEditorState,
  lineId: string,
  wordIds: string[],
  readings: string[] | undefined,
  overwriteExisting: boolean,
): ProjectEditorState {
  const line = getLineOrThrow(state.present.lyrics, lineId);
  const selectedWords = wordIds.map((id) => getWordOrThrow(line, id));
  const idSet = new Set(wordIds);
  const inLineOrder = line.words.filter((word) => idSet.has(word.id));
  if (inLineOrder.length !== wordIds.length || new Set(wordIds).size !== wordIds.length) {
    throw validationError('merge_invalid_words', `Duplicate or invalid word IDs in line "${lineId}".`);
  }

  const firstEffective = wordAgents(state.present.lyrics, line, inLineOrder[0]);
  if (inLineOrder.some((word) => !sameAgents(wordAgents(state.present.lyrics, line, word), firstEffective))) {
    throw validationError(
      'merge_singer_conflict',
      'Cannot merge words assigned to different singers.',
    );
  }

  if (
    readings !== undefined &&
    !overwriteExisting &&
    selectedWords.some((word) => word.rubyUnits.length > 0)
  ) {
    throw validationError(
      'ruby_overwrite_blocked',
      'Cannot overwrite existing ruby units during merge_words without overwrite_existing=true.',
    );
  }

  // Execute merge in canonical document word order
  const orderedIds = inLineOrder.map((word) => word.id);
  let nextState = runCommand(state, { type: 'merge-words', wordIds: orderedIds });
  if (readings !== undefined) {
    nextState = applySetWord(nextState, lineId, orderedIds[0], readings, true);
  }
  return nextState;
}

function applySetLineSpans(
  state: ProjectEditorState,
  lineId: string,
  rawSpans: Array<z.infer<typeof LineSpanSchema>>,
  overwriteExisting: boolean,
): ProjectEditorState {
  const line = getLineOrThrow(state.present.lyrics, lineId);
  const text = lineText(line);
  const lineChars = Array.from(text);

  const spans = [...rawSpans].sort((a, b) => a.base_start - b.base_start);
  let prevEnd = 0;
  for (const span of spans) {
    if (span.base_start < prevEnd) {
      throw validationError('span_overlap', `Overlapping spans around offset ${span.base_start}.`);
    }
    if (span.base_end > lineChars.length || span.base_end <= span.base_start) {
      throw validationError(
        'span_out_of_range',
        `Span [${span.base_start}, ${span.base_end}) is out of range for line "${lineId}" (length ${lineChars.length}).`,
      );
    }
    const slice = lineChars.slice(span.base_start, span.base_end).join('');
    if (span.base !== undefined && slice !== span.base) {
      throw validationError(
        'span_text_mismatch',
        `Span [${span.base_start}, ${span.base_end}) expected "${span.base}", got "${slice}".`,
      );
    }
    prevEnd = span.base_end;
  }

  // First pass: split any word cut internally by span boundaries.
  type WordInterval = { word: LyricWord; start: number; end: number };
  const wordIntervals: WordInterval[] = [];
  let cursor = 0;
  for (const word of line.words) {
    const len = Array.from(word.text).length;
    wordIntervals.push({ word, start: cursor, end: cursor + len });
    cursor += len;
  }

  let workingState = state;
  const boundaries = new Set(spans.flatMap((span) => [span.base_start, span.base_end]));

  for (const { word, start, end } of wordIntervals) {
    const overlapsSpan = spans.some((span) => span.base_start < end && span.base_end > start);
    if (!overlapsSpan) continue;
    if (!overwriteExisting && word.rubyUnits.length > 0) {
      throw validationError(
        'ruby_overwrite_blocked',
        `Word "${word.text}" (${word.id}) already has ruby units. Set overwrite_existing=true to replace.`,
      );
    }
    const cuts = [...boundaries].filter((pos) => pos > start && pos < end).sort((a, b) => a - b);
    if (!cuts.length) continue;

    const localCuts = [0, ...cuts.map((pos) => pos - start), end - start];
    const wordChars = Array.from(word.text);
    const parts = localCuts.slice(0, -1).map((a, idx) => ({
      text: wordChars.slice(a, localCuts[idx + 1]).join(''),
      readings: [] as string[],
    }));
    workingState = applySplitAndSetWord(workingState, lineId, word.id, parts, true);
  }

  // Second pass: for each span, collect covering words (merge if >1), then apply readings.
  for (const span of spans) {
    const currentLine = getLineOrThrow(workingState.present.lyrics, lineId);
    const coveringIds: string[] = [];
    let pos = 0;
    for (const word of currentLine.words) {
      const len = Array.from(word.text).length;
      const wStart = pos;
      const wEnd = pos + len;
      pos = wEnd;
      if (wStart >= span.base_start && wEnd <= span.base_end) {
        coveringIds.push(word.id);
      }
    }
    if (!coveringIds.length) {
      throw validationError(
        'span_alignment_failed',
        `Could not align span [${span.base_start}, ${span.base_end}) to line words.`,
      );
    }

    if (coveringIds.length > 1) {
      workingState = applyMergeWords(workingState, lineId, coveringIds, span.readings, true);
    } else {
      workingState = applySetWord(workingState, lineId, coveringIds[0], span.readings, true);
    }
  }

  return workingState;
}

export function registerReadingTools(registry: ToolRegistry): void {
  registry.register({
    name: 'analyze_japanese_reading',
    description:
      'Analyze Japanese lyric lines with backend Sudachi + JmdictFurigana and return code-point baseline reading ranges alongside existing word segmentation.',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    inputSchema: {
      project_id: z.string().min(1).describe('Target project ID.'),
      line_ids: z
        .array(z.string().min(1))
        .min(1)
        .optional()
        .describe('Optional specific line IDs to analyze. When omitted, paginates using start_line and limit.'),
      auto_merge: z.boolean().default(false).describe('Merge Arabic numbers with Japanese counters when proposing readings.'),
      start_line: z.number().int().min(1).default(1).describe('1-based starting line number when line_ids is omitted.'),
      limit: z.number().int().min(1).max(100).default(50).describe('Maximum number of lines to analyze (1-100).'),
    },
    execute: async ({ project_id, line_ids, start_line, limit, auto_merge }, { client }) => {
      const envelope = await client.getDocumentEnvelope(project_id);
      const doc = parseProject(envelope.document);
      const { totalLines, selected } = selectTargetLines(doc, line_ids, start_line, limit);

      const snapshotLines = selected
        .map(({ line }) => ({ id: line.id, text: lineText(line) }))
        .filter((item) => item.text.length > 0);
      const analysis = snapshotLines.length
        ? await client.analyzeJapaneseReading(snapshotLines, auto_merge)
        : { ranges: [] };

      const byLine = new Map<string, Array<{ base_start: number; base_end: number; base: string; reading: string }>>();
      for (const range of analysis.ranges) {
        const list = byLine.get(range.line_id) ?? [];
        list.push({
          base_start: range.base_start,
          base_end: range.base_end,
          base: range.base,
          reading: range.reading,
        });
        byLine.set(range.line_id, list);
      }

      return {
        project_id,
        revision: envelope.revision,
        total_lines: totalLines,
        returned_lines: selected.length,
        lines: selected.map(({ line, lineNumber }) => ({
          line_id: line.id,
          line_number: lineNumber,
          background_of: line.backgroundOf,
          text: lineText(line),
          words: line.words.map(summarizeWord),
          ranges: byLine.get(line.id) ?? [],
        })),
      };
    },
  });

  registry.register({
    name: 'list_dictionaries',
    description:
      'List installed fixed-reading pronunciation dictionaries (e.g. Mandarin, Cantonese, dialect dictionaries) with ID, instance token, name, and version.',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    inputSchema: {},
    execute: async (_args, { client }) => {
      const result = await client.listDictionaries();
      return {
        dictionaries: result.dictionaries.map((dict) => ({
          id: dict.id,
          instance: dict.instance,
          name: typeof dict.manifest?.name === 'string' ? dict.manifest.name : dict.id,
          version: typeof dict.manifest?.version === 'string' ? dict.manifest.version : null,
          language: typeof dict.manifest?.language === 'string' ? dict.manifest.language : null,
          error: dict.error,
        })),
        errors: result.errors,
      };
    },
  });

  registry.register({
    name: 'analyze_dictionary_reading',
    description:
      'Analyze lyric lines using an installed pronunciation dictionary, returning segmentation and ambiguity status per code-point range.',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    inputSchema: {
      project_id: z.string().min(1).describe('Target project ID.'),
      dictionary_id: z.string().min(1).describe('Dictionary ID returned by list_dictionaries.'),
      instance: z
        .string()
        .min(1)
        .optional()
        .describe('Optional dictionary instance token. If omitted, resolves automatically from list_dictionaries.'),
      line_ids: z
        .array(z.string().min(1))
        .min(1)
        .optional()
        .describe('Optional specific line IDs to analyze.'),
      start_line: z.number().int().min(1).default(1).describe('1-based starting line number when line_ids is omitted.'),
      limit: z.number().int().min(1).max(100).default(50).describe('Maximum number of lines to analyze (1-100).'),
    },
    execute: async ({ project_id, dictionary_id, instance, line_ids, start_line, limit }, { client }) => {
      const [envelope, resolvedInstance] = await Promise.all([
        client.getDocumentEnvelope(project_id),
        (async () => {
          if (instance) return instance;
          const dicts = await client.listDictionaries();
          const match = dicts.dictionaries.find((item) => item.id === dictionary_id);
          if (!match) {
            throw validationError('dictionary_not_found', `Dictionary "${dictionary_id}" is not installed.`);
          }
          return match.instance;
        })(),
      ]);

      const doc = parseProject(envelope.document);
      const { totalLines, selected } = selectTargetLines(doc, line_ids, start_line, limit);

      const snapshotLines = selected
        .map(({ line }) => ({ id: line.id, text: lineText(line) }))
        .filter((item) => item.text.length > 0);
      const analysis = snapshotLines.length
        ? await client.analyzeDictionaryReading(dictionary_id, resolvedInstance, snapshotLines)
        : { instance: resolvedInstance, version: '', ranges: [] };

      const byLine = new Map<
        string,
        Array<{ base_start: number; base_end: number; base: string; status: string; units: string[] }>
      >();
      for (const range of analysis.ranges) {
        const list = byLine.get(range.line_id) ?? [];
        list.push({
          base_start: range.base_start,
          base_end: range.base_end,
          base: range.base,
          status: range.status,
          units: range.units,
        });
        byLine.set(range.line_id, list);
      }

      return {
        project_id,
        revision: envelope.revision,
        dictionary_id,
        instance: analysis.instance,
        version: analysis.version,
        total_lines: totalLines,
        returned_lines: selected.length,
        lines: selected.map(({ line, lineNumber }) => ({
          line_id: line.id,
          line_number: lineNumber,
          background_of: line.backgroundOf,
          text: lineText(line),
          words: line.words.map(summarizeWord),
          ranges: byLine.get(line.id) ?? [],
        })),
      };
    },
  });

  registry.register({
    name: 'apply_readings',
    description:
      'Apply readings after body segmentation. Japanese must separate kanji/okurigana and splittable compounds (景色→景(け)+色(し,き), 世界→世(せ)+界(か,い)); retain inseparable 今日/大人 bodies with mora ruby. Prefer set_line_spans/split_and_set_word for explicit correspondence. Batch apply ruby pronunciation annotations by word_id (set_word, split_and_set_word, merge_words) or code-point line spans (set_line_spans). Preserves existing word/ruby timestamps, maintains emptyBeats, validates AMLL compatibility, and saves with optimistic concurrency CAS.',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    inputSchema: {
      project_id: z.string().min(1).describe('Target project ID.'),
      expected_revision: z.string().optional().describe('Optional expected revision for CAS check.'),
      idempotency_key: z.string().optional().describe('Optional Idempotency-Key for safe retry.'),
      overwrite_existing: z
        .boolean()
        .default(false)
        .describe('Allow replacing existing ruby units on targeted words or spans.'),
      operations: z
        .array(ReadingOperationSchema)
        .min(1)
        .describe('Ordered list of reading annotation operations to apply atomically in one saved revision.'),
    },
    execute: async ({ project_id, expected_revision, idempotency_key, overwrite_existing, operations }, { client }) => {
      return mutateProjectDocument(
        client,
        project_id,
        { expectedRevision: expected_revision, idempotencyKey: idempotency_key },
        (doc, envelope) => {
          let state = createProjectEditorState(doc);
          const touchedLineIds = new Set<string>();

          operations.forEach((op, index) => withOperationContext(op, index, envelope.revision, () => {
            touchedLineIds.add(op.line_id);
            switch (op.mode) {
              case 'set_word':
                state = applySetWord(state, op.line_id, op.word_id, op.readings, overwrite_existing);
                break;
              case 'split_and_set_word':
                state = applySplitAndSetWord(state, op.line_id, op.word_id, op.parts, overwrite_existing);
                break;
              case 'merge_words':
                state = applyMergeWords(state, op.line_id, op.word_ids, op.readings, overwrite_existing);
                break;
              case 'set_line_spans':
                state = applySetLineSpans(state, op.line_id, op.spans, overwrite_existing);
                break;
            }
          }));

          const nextDoc = state.present;
          const rubyWordCount = [...touchedLineIds].reduce((count, lineId) => {
            const line = nextDoc.lyrics.lines.find((item) => item.id === lineId);
            return count + (line ? line.words.filter((word) => word.rubyUnits.length > 0).length : 0);
          }, 0);

          return {
            nextDoc,
            summary: {
              operations_applied: operations.length,
              touched_line_count: touchedLineIds.size,
              touched_line_ids: [...touchedLineIds],
              created_word_ids: nextDoc.lyrics.lines.flatMap(line => line.words).filter(word => !doc.lyrics.lines.some(line => line.words.some(old => old.id === word.id))).map(word => word.id),
              ruby_words_in_touched_lines: rubyWordCount,
            },
          };
        },
      );
    },
  });
}
