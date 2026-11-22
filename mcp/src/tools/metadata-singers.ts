import { z } from 'zod';
import { AGENT_TYPES, type LyricAgent } from '../../../frontend/src/domain/lyric-document';
import { type LyricCommand } from '../../../frontend/src/domain/lyric-commands';
import { createProjectEditorState, executeProjectCommand } from '../../../frontend/src/domain/project-document';
import { mutateProjectDocument } from './cas';
import type { ToolRegistry } from './registry';

const AgentSchema = z.object({
  id: z.string().regex(/^[A-Za-z_][\w.-]*$/, 'Agent ID must start with a letter or underscore.'),
  name: z.string().nullable().optional(),
  type: z.enum(AGENT_TYPES).nullable().optional(),
  actor_ref: z.string().nullable().optional(),
});

export function registerMetadataAndSingerTools(registry: ToolRegistry): void {
  registry.register({
    name: 'update_metadata',
    description:
      'Incrementally update or delete TTML metadata keys (e.g. title, artist, album, lyricist, composer, arranger, songwriter, year, isrc) and/or document BCP-47 language without touching lyrics or timing.',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    inputSchema: {
      project_id: z.string().min(1).describe('Target project ID.'),
      expected_revision: z.string().optional().describe('Optional expected revision for optimistic concurrency check.'),
      idempotency_key: z.string().optional().describe('Optional Idempotency-Key for safe retry.'),
      language: z
        .string()
        .nullable()
        .optional()
        .describe('Optional BCP-47 document main language (e.g. "ja", "zh-Hans", "en"), or null to clear.'),
      set: z
        .record(z.string().min(1), z.array(z.string()))
        .optional()
        .describe('Metadata keys to set; pass an empty array [] to delete a key.'),
      delete_keys: z.array(z.string().min(1)).optional().describe('Metadata keys to remove.'),
    },
    execute: async ({ project_id, expected_revision, idempotency_key, language, set, delete_keys }, { client }) => {
      return mutateProjectDocument(
        client,
        project_id,
        { expectedRevision: expected_revision, idempotencyKey: idempotency_key },
        (doc) => {
          const commands: Extract<LyricCommand, { type: 'set-metadata' | 'set-language' }>[] = [];
          if (language !== undefined) {
            commands.push({ type: 'set-language', language });
          }
          if (set) {
            for (const [key, rawValues] of Object.entries(set)) {
              const cleaned = rawValues.map((v) => v.trim()).filter(Boolean);
              commands.push({ type: 'set-metadata', key, values: cleaned });
            }
          }
          if (delete_keys) {
            for (const key of delete_keys) {
              commands.push({ type: 'set-metadata', key, values: [] });
            }
          }

          if (!commands.length) {
            return {
              nextDoc: doc,
              summary: {
                language: doc.lyrics.language,
                metadata: doc.lyrics.metadata,
              },
            };
          }

          const nextState = executeProjectCommand(createProjectEditorState(doc), {
            type: 'lyrics',
            command: { type: 'batch', commands },
          });
          return {
            nextDoc: nextState.present,
            summary: {
              language: nextState.present.lyrics.language,
              metadata: nextState.present.lyrics.metadata,
            },
          };
        },
      );
    },
  });

  registry.register({
    name: 'manage_singers',
    description:
      'Add/update/delete singers (ttm:agent including type and actorRef) and assign line-level or word-level agentRefs, enforcing AMLL compatibility rules.',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    inputSchema: {
      project_id: z.string().min(1).describe('Target project ID.'),
      expected_revision: z.string().optional().describe('Optional expected revision for optimistic concurrency check.'),
      idempotency_key: z.string().optional().describe('Optional Idempotency-Key for safe retry.'),
      upsert_agents: z.array(AgentSchema).optional().describe('Singers/agents to add or update by id.'),
      delete_agent_ids: z.array(z.string().min(1)).optional().describe('Singer IDs to delete.'),
      line_assignments: z
        .array(
          z.object({
            line_id: z.string().min(1),
            agent_refs: z.array(z.string().min(1)),
          }),
        )
        .optional()
        .describe('Line-level agent assignments.'),
      word_assignments: z
        .array(
          z.object({
            line_id: z.string().min(1),
            word_id: z.string().min(1),
            agent_refs: z.array(z.string().min(1)),
          }),
        )
        .optional()
        .describe('Word-level agent override assignments (pass [] to clear override).'),
    },
    execute: async (
      { project_id, expected_revision, idempotency_key, upsert_agents, delete_agent_ids, line_assignments, word_assignments },
      { client },
    ) => {
      return mutateProjectDocument(
        client,
        project_id,
        { expectedRevision: expected_revision, idempotencyKey: idempotency_key },
        (doc) => {
          type AtomicCmd = Extract<
            LyricCommand,
            { type: 'set-agents' | 'delete-agent' | 'set-line-agents' | 'set-word-agents' }
          >;
          const commands: AtomicCmd[] = [];

          if (upsert_agents?.length) {
            const nextAgents: LyricAgent[] = doc.lyrics.agents.map((a) => ({ ...a }));
            for (const incoming of upsert_agents) {
              const idx = nextAgents.findIndex((a) => a.id === incoming.id);
              const existing = idx >= 0 ? nextAgents[idx] : undefined;
              const updated: LyricAgent = {
                id: incoming.id,
                name: incoming.name !== undefined ? incoming.name : (existing?.name ?? null),
                type: incoming.type !== undefined ? incoming.type : (existing?.type ?? 'person'),
                ...(incoming.actor_ref === null
                  ? {}
                  : incoming.actor_ref !== undefined
                    ? { actorRef: incoming.actor_ref }
                    : existing?.actorRef !== undefined
                      ? { actorRef: existing.actorRef }
                      : {}),
              };
              if (idx >= 0) nextAgents[idx] = updated;
              else nextAgents.push(updated);
            }
            commands.push({ type: 'set-agents', agents: nextAgents });
          }

          if (line_assignments?.length) {
            for (const item of line_assignments) {
              commands.push({ type: 'set-line-agents', lineId: item.line_id, agentRefs: item.agent_refs });
            }
          }

          if (word_assignments?.length) {
            for (const item of word_assignments) {
              commands.push({
                type: 'set-word-agents',
                lineId: item.line_id,
                wordId: item.word_id,
                agentRefs: item.agent_refs,
              });
            }
          }

          if (delete_agent_ids?.length) {
            for (const id of delete_agent_ids) {
              commands.push({ type: 'delete-agent', id });
            }
          }

          if (!commands.length) {
            return {
              nextDoc: doc,
              summary: {
                agents: doc.lyrics.agents,
                assigned_lines: 0,
                assigned_words: 0,
              },
            };
          }

          const nextState = executeProjectCommand(createProjectEditorState(doc), {
            type: 'lyrics',
            command: { type: 'batch', commands },
          });

          return {
            nextDoc: nextState.present,
            summary: {
              agents: nextState.present.lyrics.agents,
              assigned_lines: line_assignments?.length ?? 0,
              assigned_words: word_assignments?.length ?? 0,
            },
          };
        },
      );
    },
  });
}
