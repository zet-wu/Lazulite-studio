import { z } from 'zod';
import { parseProject } from '../../../frontend/src/adapters/project-codec';
import { displayLines } from '../../../frontend/src/domain/amll-compatibility';
import { lineText, translationText } from '../../../frontend/src/domain/lyric-document';
import { contentPayload, type ToolRegistry } from './registry';
import { serializeLyricTtml } from '../../../frontend/src/adapters/ttml/lyric-codec';
import { createProjectEditing } from '../../../frontend/src/domain/project-editing';
import { StudioHttpError } from '../client';

const ACTIVE_JOB_STATUSES = new Set(['queued', 'running', 'cancel_requested']);

export function registerReadTools(registry: ToolRegistry): void {
  registry.register({
    name: 'list_projects',
    description:
      'List Lazulite Studio projects with ID, name, updated_at, duration_ms, current_revision, source audio availability, and acoustic analysis status.',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    inputSchema: {
      cursor: z.string().optional().describe('Pagination cursor returned by a previous list_projects call.'),
      limit: z.number().int().min(1).max(50).default(20).describe('Maximum number of projects to return (1-50).'),
      include_details: z
        .boolean()
        .default(true)
        .describe('When true, also reads project summary and document header for duration, revision, and acoustics.'),
    },
    execute: async ({ cursor, limit, include_details }, { client }) => {
      const list = await client.listProjects(cursor, limit);
      if (!include_details) {
        return {
          items: list.items.map((item) => ({
            id: item.id,
            name: item.name,
            updated_at: item.updated_at,
          })),
          next_cursor: list.next_cursor,
        };
      }

      const items = await Promise.all(
        list.items.map(async (item) => {
          const [summary, envelope] = await Promise.all([
            client.getProject(item.id),
            client.getDocumentEnvelope(item.id),
          ]);
          const doc = parseProject(envelope.document);
          return {
            id: item.id,
            name: item.name,
            updated_at: item.updated_at,
            current_revision: envelope.revision,
            duration_ms: summary.asset?.source_duration_ms ?? summary.asset?.duration_ms ?? null,
            has_source_audio: summary.asset !== null,
            source_filename: summary.asset?.filename ?? null,
            has_acoustics: Boolean(doc.acoustics.analysisId || doc.acoustics.segments.length > 0),
            analysis_id: doc.acoustics.analysisId,
            line_count: doc.lyrics.lines.length,
          };
        }),
      );

      return { items, next_cursor: list.next_cursor };
    },
  });

  registry.register({
    name: 'get_project_summary',
    description:
      'Get a project overview including metadata, singers (agents), line counts, AMLL compatibility flags, active/recent jobs, and alignment readiness.',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    inputSchema: {
      project_id: z.string().min(1).describe('Target project ID.'),
    },
    execute: async ({ project_id }, { client }) => {
      const [summary, envelope, jobs, capabilities] = await Promise.all([
        client.getProject(project_id),
        client.getDocumentEnvelope(project_id),
        client.listJobs(project_id, 10),
        client.getCapabilities(),
      ]);
      const doc = parseProject(envelope.document);
      const alignmentCap = capabilities.items.find((item) => item.id === 'job.alignment');
      const skippedAlignment = new Set(doc.editing.skippedAlignmentLineIds);
      const alignableLines = doc.lyrics.lines.filter((line) => !skippedAlignment.has(line.id));
      const mainLineCount = doc.lyrics.lines.filter((line) => !line.backgroundOf).length;
      const backgroundLineCount = doc.lyrics.lines.length - mainLineCount;
      const timedLineCount = doc.lyrics.lines.filter((line) => line.beginMs !== null || line.endMs !== null).length;
      const rubyWordCount = doc.lyrics.lines.reduce(
        (count, line) => count + line.words.filter((word) => word.rubyUnits.length > 0).length,
        0,
      );
      const activeJobs = jobs.items.filter((job) => ACTIVE_JOB_STATUSES.has(job.status));

      return {
        project_id: summary.id,
        name: summary.name,
        updated_at: summary.updated_at,
        revision: envelope.revision,
        source_asset: summary.asset
          ? {
              id: summary.asset.id,
              filename: summary.asset.filename,
              duration_ms: summary.asset.duration_ms,
              source_duration_ms: summary.asset.source_duration_ms,
              status: summary.asset.status,
            }
          : null,
        music_cleanup_pending: Boolean(summary.music_cleanup_pending),
        language: doc.lyrics.language,
        metadata: doc.lyrics.metadata,
        agents: doc.lyrics.agents,
        counts: {
          total_lines: doc.lyrics.lines.length,
          main_lines: mainLineCount,
          background_lines: backgroundLineCount,
          timed_lines: timedLineCount,
          ruby_words: rubyWordCount,
          translation_tracks: doc.lyrics.translationTracks.length,
          romanization_tracks: doc.lyrics.romanizationTracks.length,
        },
        amll: doc.amll,
        acoustics: {
          analysis_id: doc.acoustics.analysisId,
          segment_count: doc.acoustics.segments.length,
        },
        active_jobs: activeJobs.map((job) => ({
          id: job.id,
          kind: job.kind,
          status: job.status,
          stage: job.stage,
          created_at: job.created_at,
        })),
        recent_jobs: jobs.items.slice(0, 5).map((job) => ({
          id: job.id,
          kind: job.kind,
          status: job.status,
          stage: job.stage,
          result_available: job.result_available,
          error: job.error,
        })),
        alignment_prerequisites: {
          has_source_audio: summary.asset !== null,
          has_duration: (summary.asset?.source_duration_ms ?? null) !== null,
          alignable_line_count: alignableLines.length,
          capability_enabled: Boolean(alignmentCap?.enabled),
          capability_reason: alignmentCap?.reason ?? null,
          queue_busy: activeJobs.length > 0,
        },
      };
    },
  });

  registry.register({
    name: 'get_source_metadata',
    description: 'Read source audio embedded tags/metadata and saved lyric search conditions for a project.',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    inputSchema: {
      project_id: z.string().min(1).describe('Target project ID.'),
      tags_only: z
        .boolean()
        .default(false)
        .describe('When true, ignores filename fallback and extracts only embedded audio tags.'),
    },
    execute: async ({ project_id, tags_only }, { client }) => {
      const [summary, searchConditions] = await Promise.all([
        client.getProject(project_id),
        client.getSearchConditions(project_id),
      ]);
      const sourceMetadata = summary.asset ? await client.getSourceMetadata(project_id, tags_only) : null;
      return {
        project_id: summary.id,
        has_source_audio: summary.asset !== null,
        asset_id: summary.asset?.id ?? null,
        filename: summary.asset?.filename ?? null,
        duration_ms: summary.asset?.source_duration_ms ?? summary.asset?.duration_ms ?? null,
        source_tags: sourceMetadata?.conditions ?? null,
        search_conditions: searchConditions,
      };
    },
  });

  registry.register({
    name: 'get_lyrics',
    description:
      'Read paginated compact lyric lines in display order (line_id, text, words with ruby units, timestamps, agent refs, translations/romanizations, and editing flags).',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    inputSchema: {
      project_id: z.string().min(1).describe('Target project ID.'),
      start_line: z.number().int().min(1).default(1).describe('1-based starting display line number.'),
      limit: z.number().int().min(1).max(200).default(50).describe('Maximum number of lines to return (1-200).'),
      line_ids: z.array(z.string().min(1)).min(1).optional(),
      detail: z.enum(['summary', 'compact', 'full']).default('full'),
      format: z.enum(['json', 'editable_ttml', 'exchange_ttml']).default('json'),
      include_sublyrics: z
        .boolean()
        .default(true)
        .describe('Whether to include translation and romanization entries attached to each line.'),
    },
    execute: async ({ project_id, start_line, limit, include_sublyrics, line_ids, detail, format }, { client }) => {
      const envelope = await client.getDocumentEnvelope(project_id);
      const doc = parseProject(envelope.document);
      const ordered = displayLines(doc.lyrics, doc.lineOrder);
      const offset = start_line - 1;
      if (line_ids?.some(id => !ordered.some(line => line.id === id))) throw new StudioHttpError(422, { code: 'line_not_found', message: 'A requested line ID does not exist.', retryable: false });
      const slice = line_ids ? ordered.filter(line => line_ids.includes(line.id)) : ordered.slice(offset, offset + limit);
      if (format !== 'json') {
        const selected = new Set(slice.map(line => line.id));
        const context = slice.flatMap(line => line.backgroundOf && !selected.has(line.backgroundOf) ? [line.backgroundOf] : []);
        const included = new Set([...selected, ...context]);
        const lines = ordered.filter(line => included.has(line.id));
        const agents = new Set(lines.flatMap(line => [...line.agentRefs, ...line.words.flatMap(word => word.agentRefs ?? [])]));
        for (const id of agents) {
          const actor = doc.lyrics.agents.find(agent => agent.id === id)?.actorRef;
          if (actor) agents.add(actor);
        }
        const editing = createProjectEditing();
        const objectIds = new Set(lines.flatMap(line => line.words.flatMap(word => [word.id, ...word.rubyUnits.map(unit => unit.id)])));
        editing.emptyBeats = Object.fromEntries(Object.entries(doc.editing.emptyBeats).filter(([id]) => objectIds.has(id)));
        editing.ignoredSyncLineIds = doc.editing.ignoredSyncLineIds.filter(id => included.has(id));
        editing.skippedAlignmentLineIds = doc.editing.skippedAlignmentLineIds.filter(id => included.has(id));
        editing.endLinks = Object.fromEntries(Object.entries(doc.editing.endLinks).filter(([id, target]) => included.has(id) && included.has(target)));
        const external = Object.fromEntries(Object.entries(doc.editing.endLinks).filter(([id, target]) => included.has(id) && !included.has(target)));
        const lyrics = { ...doc.lyrics, lines, agents: doc.lyrics.agents.filter(agent => agents.has(agent.id)),
          translationTracks: include_sublyrics ? doc.lyrics.translationTracks.map(track => ({ ...track, contents: track.contents.filter(content => included.has(content.lineId)) })).filter(track => track.contents.length) : [],
          romanizationTracks: include_sublyrics ? doc.lyrics.romanizationTracks.map(track => ({ ...track, contents: track.contents.filter(content => included.has(content.lineId)) })).filter(track => track.contents.length) : [],
        };
        const partial = selected.size !== ordered.length || !include_sublyrics;
        return contentPayload([{ type: 'text', text: JSON.stringify({ project_id, revision: envelope.revision, profile: format, partial,
          roundtrip_safe: false, range: { start_line, line_ids: slice.map(line => line.id) }, context_only_line_ids: [...new Set(context)],
          omitted_fields: ['karaoke', 'acoustics', 'amll', 'lineOrder', ...(!include_sublyrics ? ['sublyrics'] : [])],
          sidecar: { editing, external_end_links: external }, warning: 'This is a lyric view; do not import a sliced or filtered view with replace_all.' }) },
          { type: 'text', text: serializeLyricTtml(lyrics, { draft: format === 'editable_ttml', editing }) }]);
      }
      const ignoredSync = new Set(doc.editing.ignoredSyncLineIds);
      const skippedAlignment = new Set(doc.editing.skippedAlignmentLineIds);

      const lines = slice.map((line, idx) => {
        const entry: Record<string, unknown> = {
          line_number: ordered.indexOf(line) + 1,
          line_id: line.id,
          text: lineText(line),
          begin_ms: line.beginMs,
          end_ms: line.endMs,
          agent_refs: line.agentRefs,
          background_of: line.backgroundOf,
          song_part: line.songPart,
          skip_sync: ignoredSync.has(line.id),
          skip_alignment: skippedAlignment.has(line.id),
          end_linked_to: doc.editing.endLinks[line.id] ?? null,
          words: line.words.map((word) => {
            const wordBeats = doc.editing.emptyBeats[word.id]?.count ?? 0;
            return {
              word_id: word.id,
              text: word.text,
              begin_ms: word.beginMs,
              end_ms: word.endMs,
              obscene: word.obscene,
              ...(wordBeats ? { empty_beat_count: wordBeats } : {}),
              ...(word.agentRefs ? { agent_refs: word.agentRefs } : {}),
              ruby_units: word.rubyUnits.map((unit) => {
                const rubyBeats = doc.editing.emptyBeats[unit.id]?.count ?? 0;
                return {
                  ruby_id: unit.id,
                  reading: unit.reading,
                  begin_ms: unit.beginMs,
                  end_ms: unit.endMs,
                  ...(rubyBeats ? { empty_beat_count: rubyBeats } : {}),
                };
              }),
            };
          }),
        };

        if (include_sublyrics) {
          const translations = doc.lyrics.translationTracks.flatMap((track) =>
            track.contents
              .filter((content) => content.lineId === line.id)
              .map((content) => ({
                track_id: track.id,
                content_id: content.id,
                language: track.language,
                purpose: track.purpose,
                kind: content.kind,
                text: translationText(content),
                ...(content.kind === 'timed' ? { units: content.units.map(u => ({ unit_id: u.id, text: u.text, begin_ms: u.beginMs, end_ms: u.endMs })) } : {}),
              })),
          );
          const romanizations = doc.lyrics.romanizationTracks.flatMap((track) =>
            track.contents
              .filter((content) => content.lineId === line.id)
              .map((content) => ({
                track_id: track.id,
                content_id: content.id,
                language: track.language,
                kind: content.kind,
                text: translationText(content),
                ...(content.kind === 'timed'
                  ? {
                      units: content.units.map((u) => ({
                        unit_id: u.id,
                        text: u.text,
                        begin_ms: u.beginMs,
                        end_ms: u.endMs,
                      })),
                    }
                  : {}),
              })),
          );
          if (translations.length) entry.translations = translations;
          if (romanizations.length) entry.romanizations = romanizations;
        }

        if (detail === 'summary') {
          delete entry.words;
          entry.word_count = line.words.length;
          entry.ruby_count = line.words.reduce((n, word) => n + word.rubyUnits.length, 0);
          entry.translation_count = doc.lyrics.translationTracks.reduce((n, track) => n + track.contents.filter(content => content.lineId === line.id).length, 0);
          entry.romanization_count = doc.lyrics.romanizationTracks.reduce((n, track) => n + track.contents.filter(content => content.lineId === line.id).length, 0);
          delete entry.translations; delete entry.romanizations;
        } else if (detail === 'compact') entry.words = line.words.map(word => ({ word_id: word.id, text: word.text, begin_ms: word.beginMs, end_ms: word.endMs, ruby: word.rubyUnits.map(unit => unit.reading) }));
        return entry;
      });

      return {
        project_id,
        revision: envelope.revision,
        total_lines: ordered.length,
        start_line,
        returned_lines: lines.length,
        has_more: !line_ids && offset + lines.length < ordered.length,
        lines,
      };
    },
  });
}
