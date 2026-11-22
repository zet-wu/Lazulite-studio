import { z } from 'zod';
import { lyricCapabilities } from '../../../frontend/src/adapters/lyric-capabilities';
import { importLyricFile, type LyricFormat } from '../../../frontend/src/adapters/lyric-formats';
import { attachSidecar } from '../../../frontend/src/adapters/source-codec';
import { lineText, type LyricDocument } from '../../../frontend/src/domain/lyric-document';
import { createProjectEditorState, executeProjectCommand } from '../../../frontend/src/domain/project-document';
import { applyBackgroundDefaults, createProjectEditing, defaultBackgroundDefaults } from '../../../frontend/src/domain/project-editing';
import type { OnlineLyricCandidate, OnlineLyricSource } from '../client';
import { mutateProjectDocument } from './cas';
import type { ToolRegistry } from './registry';

const SOURCES: OnlineLyricSource[] = ['netease', 'qqmusic', 'kugou', 'amll'];
const IMPORTABLE_FORMATS = ['txt', 'lrc', 'elrc', 'eslrc', 'qrc', 'krc', 'yrc', 'lys', 'ttml'] as const;

const CandidateSchema = z.object({
  source: z.enum(['netease', 'qqmusic', 'kugou', 'amll']),
  id: z.string().min(1),
  title: z.string().default(''),
  artists: z.array(z.string()).default([]),
  album: z.string().default(''),
  duration_ms: z.number().int().nullable().default(null),
  songmid: z.string().nullable().optional(),
  songid: z.string().nullable().optional(),
  platform: z.string().nullable().optional(),
  file: z.string().nullable().optional(),
});

function mergeMetadata(
  current: Record<string, string[]>,
  incoming: Record<string, string[]>,
  mode: 'keep_existing' | 'merge_incoming_missing' | 'replace_with_incoming',
): Record<string, string[]> {
  if (mode === 'keep_existing') return current;
  if (mode === 'replace_with_incoming') {
    const out: Record<string, string[]> = {};
    for (const [key, values] of Object.entries(incoming)) {
      if (values.length) out[key] = [...values];
    }
    return out;
  }
  const out: Record<string, string[]> = {};
  for (const key of new Set([...Object.keys(current), ...Object.keys(incoming)])) {
    const values = current[key]?.length ? current[key] : incoming[key];
    if (values?.length) out[key] = [...values];
  }
  return out;
}

export function registerLyricAcquisitionTools(registry: ToolRegistry): void {
  registry.register({
    name: 'search_online_lyrics',
    description:
      'Search built-in online lyric providers (netease, qqmusic, kugou, amll) for candidate lyrics matching a query.',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    inputSchema: {
      query: z.string().min(1).max(200).describe('Search query string (typically song title + artist).'),
      source: z
        .enum(['all', 'netease', 'qqmusic', 'kugou', 'amll'])
        .default('all')
        .describe('Specific provider or "all" to query all four in parallel.'),
    },
    execute: async ({ query, source }, { client }) => {
      if (source !== 'all') {
        const res = await client.searchOnlineLyrics(source, query);
        return { query, items: res.items };
      }

      const settled = await Promise.allSettled(
        SOURCES.map(async (provider) => ({
          provider,
          items: (await client.searchOnlineLyrics(provider, query)).items,
        })),
      );
      const items: OnlineLyricCandidate[] = [];
      const sourceErrors: Record<string, string> = {};
      for (let i = 0; i < settled.length; i++) {
        const result = settled[i];
        const provider = SOURCES[i];
        if (result.status === 'fulfilled') {
          items.push(...result.value.items);
        } else {
          sourceErrors[provider] =
            result.reason instanceof Error ? result.reason.message : String(result.reason);
        }
      }
      return {
        query,
        items,
        ...(Object.keys(sourceErrors).length ? { source_errors: sourceErrors } : {}),
      };
    },
  });

  registry.register({
    name: 'fetch_online_lyrics',
    description:
      'Fetch raw lyric payload (format, content, optional translation/romanization sidecars, metadata, and parsed line preview) for an online candidate. Automatically resolves QQ songmid when needed.',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    inputSchema: {
      candidate: CandidateSchema.describe('Candidate object returned by search_online_lyrics.'),
      preview_lines: z.number().int().min(1).max(200).default(30).describe('Max preview lines to include.'),
    },
    execute: async ({ candidate, preview_lines }, { client }) => {
      let target: OnlineLyricCandidate = candidate;
      if (target.source === 'qqmusic' && !target.songmid && target.songid) {
        target = await client.resolveOnlineLyric(target);
      }
      const payload = await client.fetchOnlineLyric(target);
      if (payload.empty || !payload.content || !payload.format || payload.format === 'lys') {
        return {
          empty: true,
          format: payload.format ?? null,
          content: payload.content ?? '',
          metadata: payload.metadata ?? {},
        };
      }

      let partial = payload.partial === true;
      const lineTimedWords = new Set<string>();
      const parsed = importLyricFile(
        payload.content,
        payload.format as Exclude<LyricFormat, 'ass'>,
        () => {
          partial = true;
        },
        lineTimedWords,
      );
      for (const [sideText, kind] of [
        [payload.translation, 'translation'],
        [payload.romanization, 'romanization'],
      ] as const) {
        if (!sideText) continue;
        try {
          if (attachSidecar(parsed, sideText, kind).length) partial = true;
        } catch {
          partial = true;
        }
      }

      return {
        empty: false,
        format: payload.format,
        content: payload.content,
        metadata: { ...(payload.metadata ?? {}), ...parsed.metadata },
        ...(payload.translation ? { translation: payload.translation } : {}),
        ...(payload.romanization ? { romanization: payload.romanization } : {}),
        partial,
        line_count: parsed.lines.length,
        capabilities: lyricCapabilities(parsed, lineTimedWords),
        preview: parsed.lines.slice(0, preview_lines).map((line, index) => ({
          line_number: index + 1,
          text: lineText(line),
          begin_ms: line.beginMs,
          end_ms: line.endMs,
          background: Boolean(line.backgroundOf),
        })),
      };
    },
  });

  registry.register({
    name: 'get_embedded_lyrics',
    description: 'Read lyric candidates embedded inside the project source audio file (MP3 USLT, FLAC tags, MP4/M4A tags & STPP).',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    inputSchema: {
      project_id: z.string().min(1).describe('Target project ID.'),
    },
    execute: async ({ project_id }, { client }) => {
      const res = await client.getEmbeddedLyrics(project_id);
      return { project_id, candidates: res.candidates };
    },
  });

  registry.register({
    name: 'import_lyrics',
    description:
      'Parse plain text or lyric formats (txt, lrc, elrc, eslrc, qrc, krc, yrc, lys, ttml) and import into the project. Requires explicit mode ("replace_if_empty" or "replace_all") to prevent accidental overwrite of refined lyrics.',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    inputSchema: {
      project_id: z.string().min(1).describe('Target project ID.'),
      content: z.string().min(1).describe('Raw lyric text or format payload to import.'),
      format: z.enum(IMPORTABLE_FORMATS).describe('Lyric format of content.'),
      mode: z
        .enum(['replace_if_empty', 'replace_all'])
        .describe('Explicit import mode: "replace_if_empty" refuses if project already has non-empty or timed lyrics; "replace_all" replaces existing lyrics.'),
      translation: z.string().optional().describe('Optional sidecar translation payload (LRC or QRC).'),
      romanization: z.string().optional().describe('Optional sidecar romanization payload (LRC or QRC).'),
      metadata_mode: z
        .enum(['keep_existing', 'merge_incoming_missing', 'replace_with_incoming'])
        .default('merge_incoming_missing')
        .describe('How to merge existing project metadata with incoming metadata.'),
      incoming_metadata: z
        .record(z.string(), z.array(z.string()))
        .optional()
        .describe('Optional metadata from fetch_online_lyrics to merge according to metadata_mode.'),
      expected_revision: z.string().optional().describe('Optional expected revision for optimistic concurrency check.'),
      idempotency_key: z.string().optional().describe('Optional Idempotency-Key for safe retry.'),
    },
    execute: async (
      {
        project_id,
        content,
        format,
        mode,
        translation,
        romanization,
        metadata_mode,
        incoming_metadata,
        expected_revision,
        idempotency_key,
      },
      { client },
    ) => {
      return mutateProjectDocument(
        client,
        project_id,
        { expectedRevision: expected_revision, idempotencyKey: idempotency_key },
        (doc) => {
          if (mode === 'replace_if_empty') {
            const hasContent = doc.lyrics.lines.some(
              (line) =>
                line.beginMs !== null ||
                line.endMs !== null ||
                line.words.some((w) => w.text.trim() !== '' || w.beginMs !== null || w.endMs !== null || w.rubyUnits.length > 0),
            );
            if (hasContent) {
              throw new Error(
                'Project already contains lyrics or timing. Re-run with mode="replace_all" if you intentionally want to replace them.',
              );
            }
          }

          let partialSidecar = false;
          const imported: LyricDocument = importLyricFile(content, format, () => {
            partialSidecar = true;
          });
          if (!imported.lines.some((line) => line.words.some((word) => word.text.trim()))) {
            throw new Error('Imported lyric content contains no non-empty lyric text.');
          }

          const sidecarIssues: string[] = [];
          for (const [sideText, kind] of [
            [translation, 'translation'],
            [romanization, 'romanization'],
          ] as const) {
            if (!sideText?.trim()) continue;
            sidecarIssues.push(...attachSidecar(imported, sideText, kind));
          }

          const combinedIncomingMeta = { ...(incoming_metadata ?? {}), ...imported.metadata };
          const mergedMetadata = mergeMetadata(doc.lyrics.metadata, combinedIncomingMeta, metadata_mode);
          const nextLyrics: LyricDocument = {
            ...imported,
            metadata: mergedMetadata,
            language: imported.language ?? doc.lyrics.language,
          };

          const editing = createProjectEditing();
          applyBackgroundDefaults({ ...nextLyrics, lines: [] }, nextLyrics, editing, defaultBackgroundDefaults);

          const nextState = executeProjectCommand(createProjectEditorState(doc), {
            type: 'lyrics',
            command: { type: 'replace-document', editing, document: nextLyrics },
          });

          const timedLines = nextState.present.lyrics.lines.filter(
            (line) => line.beginMs !== null || line.endMs !== null,
          ).length;

          return {
            nextDoc: nextState.present,
            summary: {
              format,
              line_count: nextState.present.lyrics.lines.length,
              timed_lines: timedLines,
              has_translations: nextState.present.lyrics.translationTracks.some((t) => t.contents.length > 0),
              has_romanizations: nextState.present.lyrics.romanizationTracks.some((t) => t.contents.length > 0),
              partial_sidecar: partialSidecar || sidecarIssues.length > 0,
              metadata: nextState.present.lyrics.metadata,
            },
          };
        },
      );
    },
  });
}
