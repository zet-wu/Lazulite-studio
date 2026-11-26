import { displayLines } from '../../../frontend/src/domain/amll-compatibility';
import { parseProject } from '../../../frontend/src/adapters/project-codec';
import { toRomaji } from 'wanakana';
import { lineText } from '../../../frontend/src/domain/lyric-document';
import { id, invalid, requireLine } from './editing';
import { z } from 'zod';
import { localAlignmentTargets, mergeAlignment, type AlignmentResult } from '../../../frontend/src/domain/alignment';
import { assertAmll } from '../../../frontend/src/domain/amll-compatibility';
import { validateProjectEditing } from '../../../frontend/src/domain/project-editing';
import { StudioHttpError, type AlignmentOptions } from '../client';
import { mutateProjectDocument, type MutationResult } from './cas';
import type { ToolRegistry } from './registry';

const ACTIVE_JOB_STATUSES = new Set(['queued', 'running', 'cancel_requested']);

function toolError(status: number, code: string, message: string, extra: Partial<{ retryable: boolean; params: Record<string, unknown> }> = {}) {
  return new StudioHttpError(status, {
    code,
    message,
    retryable: extra.retryable ?? false,
    ...(extra.params ? { params: extra.params } : {}),
  });
}

const scopeSchema = () => ({
  scope_ids: z.array(id()).min(2).optional().describe('Reading leaf IDs; mutually exclusive with scope_line_ids and scope_word_ids.'),
  scope_line_ids: z.array(id()).min(1).optional().describe('Local row selection; includes row/word/ruby union envelope without padding.'),
  scope_word_ids: z.array(id()).min(1).optional().describe('Local word selection; includes word/ruby union envelope without padding.'),
});
async function resolveScope(client: import('../client').StudioClient, projectId: string, revision: string, args: {scope_ids?:string[];scope_line_ids?:string[];scope_word_ids?:string[]}) {
  if ([args.scope_ids,args.scope_line_ids,args.scope_word_ids].filter(value => value !== undefined).length > 1) invalid('scope_ids, scope_line_ids and scope_word_ids are mutually exclusive.');
  const ids = args.scope_line_ids ?? args.scope_word_ids;
  if (!ids) return {scope_ids:args.scope_ids ?? null,scope_envelope_ids:null};
  const envelope = await client.getDocumentEnvelope(projectId);
  if (envelope.revision !== revision) throw toolError(412,'revision_conflict','Selection revision changed; read and preview again.');
  const doc = parseProject(envelope.document), kind = args.scope_line_ids ? 'lines' : 'words';
  if (new Set(ids).size !== ids.length || ids.some(id => kind === 'lines' ? !doc.lyrics.lines.some(line => line.id === id) : !doc.lyrics.lines.some(line => line.words.some(word => word.id === id)))) invalid('Selection contains duplicate or unknown line/word IDs.');
  const scope = localAlignmentTargets(doc.lyrics,kind,ids);
  if (scope.ids.length < 2) invalid('Local alignment requires at least two reading leaves.');
  if (scope.beginMs === null || scope.endMs === null || scope.beginMs >= scope.endMs) invalid('Selected units have no valid time envelope; set row/word timing first.');
  return {scope_ids:scope.ids,scope_envelope_ids:scope.envelopeIds};
}

export function registerAlignmentTools(registry: ToolRegistry): void {
  registry.register({
    name:'inspect_alignment_anomalies',
    description:'Read-only M8 anomaly scan after Japanese first-pass alignment. balanced flags short units OR adjacent same-vowel/reading imbalance; conservative only flags imbalance. Missing/invalid timings are also reported for repair. Use get_acoustics before choosing a safe row envelope and a different alignment model.',
    annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true},
    inputSchema:{project_id:id(),line_ids:z.array(id()).min(1).optional(),short_threshold_ms:z.number().int().positive().default(40),mode:z.enum(['balanced','conservative']).default('balanced')},
    execute:async(args,{client})=>{
      const envelope=await client.getDocumentEnvelope(args.project_id),doc=parseProject(envelope.document);
      args.line_ids?.forEach(id=>requireLine(doc,id));
      const ordered=displayLines(doc.lyrics,doc.lineOrder);
      const lines=ordered.filter(line=>args.line_ids ? args.line_ids.includes(line.id) : !doc.editing.skippedAlignmentLineIds.includes(line.id));
      const anomalies=lines.flatMap(line=>{
        const leaves=line.words.flatMap<{id:string;text:string;beginMs:number|null;endMs:number|null}>(word=>word.rubyUnits.length ? word.rubyUnits.filter(u=>u.reading.trim()).map(u=>({...u,text:u.reading})) : word.text.trim() ? [word] : []);
        const reasons=new Set<string>(),flags=new Map<string, {unit_id:string;text:string;begin_ms:number|null;end_ms:number|null;duration_ms:number|null;reasons:string[]}>();
        const flag=(unit:typeof leaves[number],reason:string)=>{
          reasons.add(reason);
          let item=flags.get(unit.id);
          if(!item){item={unit_id:unit.id,text:unit.text,begin_ms:unit.beginMs,end_ms:unit.endMs,duration_ms:unit.beginMs===null||unit.endMs===null?null:unit.endMs-unit.beginMs,reasons:[]};flags.set(unit.id,item);}
          if(!item.reasons.includes(reason))item.reasons.push(reason);
        };
        const valid=(unit:typeof leaves[number])=>unit.beginMs!==null&&unit.endMs!==null&&unit.endMs>unit.beginMs;
        for(const unit of leaves){
          if(unit.beginMs===null||unit.endMs===null)flag(unit,'missing_timing');
          else if(!valid(unit))flag(unit,'invalid_timing');
          else if(args.mode==='balanced'&&unit.endMs!-unit.beginMs!<args.short_threshold_ms)flag(unit,'short_unit');
        }
        for(let index=1;index<leaves.length;index++){
          const left=leaves[index-1],right=leaves[index];if(!valid(left)||!valid(right))continue;
          const a=toRomaji(left.text).toLowerCase(),b=toRomaji(right.text).toLowerCase();
          // M8 compares identical readings or vowels touching at the unit boundary.
          const same=!!a&&(a===b||/[aeiou]$/.test(a)&&b[0]===a.at(-1));
          const small=Math.min(left.endMs!-left.beginMs!,right.endMs!-right.beginMs!),large=Math.max(left.endMs!-left.beginMs!,right.endMs!-right.beginMs!);
          if(same&&(small<40||small<80&&large>=4*small)){flag(left,'same_vowel_imbalance');flag(right,'same_vowel_imbalance');}
        }
        const scope=localAlignmentTargets(doc.lyrics,'lines',[line.id]);
        if(!reasons.size)return [];
        return [{line_id:line.id,line_number:ordered.indexOf(line)+1,text:lineText(line),reasons:[...reasons],line_envelope_ms:[scope.beginMs,scope.endMs],flagged_units:[...flags.values()]}];
      });
      return {revision:envelope.revision,scanned_lines:lines.length,anomaly_count:anomalies.length,anomalies};
    },
  });

  registry.register({
    name: 'list_alignment_models',
    description:
      'List installed forced-alignment models and their availability status (ready, missing, invalid).',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    inputSchema: {
      refresh: z
        .boolean()
        .default(false)
        .describe('When true, rescans the alignment models directory and hardware devices.'),
    },
    execute: async ({ refresh }, { client }) => {
      const catalog = await client.listAlignmentModels(refresh);
      return {
        source: catalog.source,
        error: catalog.error,
        items: catalog.items.map((item) => ({
          id: item.id,
          name: item.name,
          type: item.type,
          status: item.status,
          ...(item.reason ? { reason: item.reason } : {}),
        })),
      };
    },
  });

  registry.register({
    name: 'preview_alignment',
    description:
      'Preview forced-alignment input for the current saved document revision (or specified revision), returning alignable lines, unknown token warnings, and a model_preview token for start_alignment. scope_line_ids/scope_word_ids resolve local reading leaves and parent union envelopes without padding; mutually exclusive with scope_ids. After NextFire use anomaly diagnosis + acoustics, then a different MMS_FA model with smart_extend=true, never same-model local retry.',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    inputSchema: {
      project_id: z.string().min(1).describe('Target project ID.'),
      model_id: z.string().min(1).describe('Alignment model ID returned by list_alignment_models.'),
      ...scopeSchema(),
      revision: z
        .string()
        .min(1)
        .optional()
        .describe('Saved document revision to preview. Defaults to the latest saved revision.'),
      detail: z.enum(['summary', 'issues', 'full']).default('summary'),
      line_ids: z.array(z.string().min(1)).min(1).optional(),
      convert_particles: z.boolean().default(true).describe('Normalize Japanese particles (は→わ / へ→え / を→お).'),
      latin_normalize: z.boolean().default(true).describe('Normalize Latin characters for phoneme conversion.'),
      strip_tone_digits: z.boolean().default(false).describe('Strip tone digits from pinyin/romanized tokens.'),
    },
    execute: async (
      { project_id, model_id, revision, convert_particles, latin_normalize, strip_tone_digits, detail, line_ids, ...selection },
      { client },
    ) => {
      const targetRevision = revision ?? (await client.getDocumentEnvelope(project_id)).revision;
      const scope = await resolveScope(client,project_id,targetRevision,selection);
      const summary = await client.previewAlignment(project_id, targetRevision, model_id, {
        convert_particles,
        latin_normalize,
        strip_tone_digits,
        ...scope,
      });
      const { inputs = [], ...counts } = summary;
      let allowed: Set<string> | undefined;
      if (line_ids && detail !== 'summary') {
        const { parseProject } = await import('../../../frontend/src/adapters/project-codec');
        const envelope = await client.getDocumentEnvelope(project_id);
        if (envelope.revision !== targetRevision) throw toolError(412, 'revision_conflict', 'Preview revision changed; read and preview again.');
        const doc = parseProject(envelope.document);
        allowed = new Set(doc.lyrics.lines.filter(line => line_ids.includes(line.id)).flatMap(line => line.words.flatMap(word => [word.id, ...word.rubyUnits.map(unit => unit.id)])));
      }
      const issues = inputs.filter(input => input.problem || input.unknown_characters?.length);
      return { project_id, revision: targetRevision, model_id, ...scope, ...counts,
        ...(detail === 'summary' ? { issues: issues.map(({ object_id, problem, unknown_characters }) => ({ object_id, problem, unknown_characters })) }
          : { inputs: (detail === 'full' ? inputs : issues).filter(input => !allowed || allowed.has(input.object_id)) }),
      };
    },
  });

  registry.register({
    name: 'start_alignment',
    description:
      'Submit an asynchronous forced-alignment job on the saved project revision and return job_id immediately (auto-chains vocal separation if missing). Returns retryable busy guidance when the project queue slot is occupied. Use matching preview scope/options/revision. scope_line_ids/scope_word_ids are local shortcuts; scope_ids is the direct leaf path. Keep vocals/crop enabled and blank/rest heuristics off. For Japanese NextFire anomalies switch to MMS_FA+smart_extend=true after acoustic review; never retry locally with the same model.',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    inputSchema: {
      project_id: z.string().min(1).describe('Target project ID.'),
      revision: z
        .string()
        .min(1)
        .optional()
        .describe('Saved revision to align against. Defaults to latest saved revision.'),
      model_preview: z
        .string()
        .min(1)
        .optional()
        .describe('model_preview token from preview_alignment. If omitted, provide model_id to auto-preview first.'),
      model_id: z
        .string()
        .min(1)
        .optional()
        .describe('Alignment model ID used to run preview automatically when model_preview is omitted.'),
      idempotency_key: z.string().min(1).optional().describe('Optional Idempotency-Key for safe retry.'),
      convert_particles: z.boolean().default(true),
      latin_normalize: z.boolean().default(true),
      strip_tone_digits: z.boolean().default(false),
      audio_source: z.enum(['vocals','original']).default('vocals').describe('Audio waveform source; original with crop_vocals=false skips separation.'),
      crop_vocals: z.boolean().default(true).describe('Intersect the selected envelope with vocal analysis segments.'),
      ...scopeSchema(),
      use_hints: z.boolean().default(false),
      line_blank: z.boolean().default(false),
      rest_blank: z.boolean().default(false),
      rest_token: z.boolean().default(false),
      clear_unmatched: z.boolean().default(false),
      smart_extend: z.boolean().default(false),
      merge_short_gaps: z.boolean().default(false),
      gap_threshold_ms: z.number().int().min(1).default(500),
    },
    execute: async (args, { client }) => {
      const targetRevision = args.revision ?? (await client.getDocumentEnvelope(args.project_id)).revision;
      const scope = await resolveScope(client,args.project_id,targetRevision,args);
      let modelPreview = args.model_preview;
      if (!modelPreview) {
        if (!args.model_id) {
          throw toolError(
            422,
            'model_required',
            'Provide either model_preview (from preview_alignment) or model_id.',
          );
        }
        const summary = await client.previewAlignment(args.project_id, targetRevision, args.model_id, {
          convert_particles: args.convert_particles,
          latin_normalize: args.latin_normalize,
          strip_tone_digits: args.strip_tone_digits,
          ...scope,
        });
        if (!summary.emitting_count) {
          throw toolError(
            422,
            'alignment_no_emitting_units',
            `Model "${args.model_id}" produced 0 emitting alignment units for project "${args.project_id}".`,
          );
        }
        modelPreview = summary.model_preview;
      }

      const activeCheck = await client.listJobs(args.project_id, 10);
      const blocking = activeCheck.items.find(
        (job) => ['vocal', 'alignment'].includes(job.kind) && ACTIVE_JOB_STATUSES.has(job.status),
      );
      if (blocking) {
        throw toolError(
          409,
          'job_slot_busy',
          `Project already has an active ${blocking.kind} job (${blocking.id}, status=${blocking.status}). Wait for completion or cancel it before starting alignment.`,
          {
            retryable: true,
            params: {
              active_job_id: blocking.id,
              active_job_kind: blocking.kind,
              active_job_status: blocking.status,
              active_job_stage: blocking.stage,
            },
          },
        );
      }

      const options: AlignmentOptions = {
        audio_source:args.audio_source, crop_vocals:args.crop_vocals,...scope,
        convert_particles: args.convert_particles,
        latin_normalize: args.latin_normalize,
        strip_tone_digits: args.strip_tone_digits,
        model_preview: modelPreview,
        use_hints: args.use_hints,
        line_blank: args.line_blank,
        rest_blank: args.rest_blank,
        rest_token: args.rest_token,
        clear_unmatched: args.clear_unmatched,
        smart_extend: args.smart_extend,
        merge_short_gaps: args.merge_short_gaps,
        gap_threshold_ms: args.gap_threshold_ms,
      };

      try {
        const job = await client.startAlignment(
          args.project_id,
          targetRevision,
          options,
          args.idempotency_key,
        );
        return {
          job_id: job.id,
          project_id: job.project_id,
          kind: job.kind,
          status: job.status,
          stage: job.stage,
          revision: targetRevision,
          created_at: job.created_at,
        };
      } catch (err) {
        if (err instanceof StudioHttpError && err.status === 409) {
          const jobs = await client.listJobs(args.project_id, 10);
          const busyJob = jobs.items.find(
            (job) => ['vocal', 'alignment'].includes(job.kind) && ACTIVE_JOB_STATUSES.has(job.status),
          );
          if (busyJob) {
            throw toolError(
              409,
              'job_slot_busy',
              `Project already has an active ${busyJob.kind} job (${busyJob.id}, status=${busyJob.status}). Wait for completion or cancel it before retrying.`,
              {
                retryable: true,
                params: {
                  active_job_id: busyJob.id,
                  active_job_kind: busyJob.kind,
                  active_job_status: busyJob.status,
                },
              },
            );
          }
        }
        throw err;
      }
    },
  });

  registry.register({
    name: 'get_job_status',
    description:
      'Query background job status, stage, progress, acknowledgement state, hardware engine info, and error details (including cpu_retry availability). Default summary omits engine configuration; detail=full returns the complete engine.',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    inputSchema: {
      job_id: z.string().min(1).describe('Job ID returned by start_alignment or get_project_summary.'),
      detail: z.enum(['summary', 'full']).default('summary'),
    },
    execute: async ({ job_id, detail }, { client }) => {
      const job = await client.getJob(job_id);
      return {
        job_id: job.id,
        project_id: job.project_id,
        kind: job.kind,
        status: job.status,
        stage: job.stage,
        ...(typeof job.progress === 'number' ? { progress: job.progress } : {}),
        model: job.request.model ?? (job.request.model_name ? { name: job.request.model_name } : null),
        devices: job.request.devices ?? null,
        reused_vocal: job.request.reused_vocal ?? null,
        result_available: job.result_available,
        acknowledged_state: job.acknowledged_state ?? null,
        bound_revision:
          typeof job.request.revision === 'string'
            ? job.request.revision
            : typeof job.request.bound_revision === 'string'
              ? job.request.bound_revision
              : null,
        error: job.error
          ? {
              code: job.error.code ?? null,
              message: job.error.message ?? null,
              cpu_retry: Boolean(job.error.cpu_retry),
              stage: job.error.stage ?? null,
            }
          : null,
        engine: detail === 'full' || job.engine === null ? job.engine
          : Object.fromEntries(Object.entries(job.engine).filter(([key]) => !['configuration_yaml', 'config', 'training'].includes(key))),
        created_at: job.created_at,
        updated_at: job.updated_at,
      };
    },
  });

  registry.register({
    name: 'cancel_job',
    description: 'Cancel a queued or running background job.',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    inputSchema: {
      job_id: z.string().min(1).describe('Job ID to cancel.'),
    },
    execute: async ({ job_id }, { client }) => {
      const job = await client.cancelJob(job_id);
      return {
        job_id: job.id,
        project_id: job.project_id,
        kind: job.kind,
        status: job.status,
        stage: job.stage,
        updated_at: job.updated_at,
      };
    },
  });

  registry.register({
    name: 'apply_alignment_result',
    description:
      'Fetch the result of a succeeded alignment job, verify binding revision & source asset match, apply mergeAlignment (envelope recomputation, short-gap merging, acoustics update), save via If-Match CAS, and mark the job acknowledged as applied.',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    inputSchema: {
      job_id: z.string().min(1).describe('Succeeded alignment job ID.'),
      project_id: z.string().min(1).optional().describe('Optional project ID sanity check.'),
      expected_revision: z.string().min(1).optional().describe('Optional expected document revision.'),
      idempotency_key: z.string().min(1).optional().describe('Optional Idempotency-Key for safe retry.'),
      clear_unmatched: z
        .boolean()
        .optional()
        .describe('Override job clear_unmatched option when merging alignment.'),
      merge_short_gaps: z
        .boolean()
        .optional()
        .describe('Override job merge_short_gaps option when merging alignment.'),
      gap_threshold_ms: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe('Override job gap_threshold_ms option when merging short gaps.'),
    },
    execute: async (
      {
        job_id,
        project_id,
        expected_revision,
        idempotency_key,
        clear_unmatched,
        merge_short_gaps,
        gap_threshold_ms,
      },
      { client, idempotency },
    ) => {
      const job = await client.getJob(job_id);
      if (job.kind !== 'alignment') {
        throw toolError(422, 'invalid_job_kind', `Job "${job_id}" has kind "${job.kind}", expected "alignment".`);
      }
      if (project_id && job.project_id !== project_id) {
        throw toolError(
          422,
          'project_mismatch',
          `Job "${job_id}" belongs to project "${job.project_id}", not "${project_id}".`,
        );
      }
      if (job.status !== 'succeeded' || !job.result_available) {
        throw toolError(
          409,
          'result_not_ready',
          `Alignment job "${job_id}" is not ready (status=${job.status}, result_available=${job.result_available}).`,
          { retryable: ACTIVE_JOB_STATUSES.has(job.status) },
        );
      }

      const [result, summary] = await Promise.all([
        client.getJobResult<AlignmentResult>(job_id),
        client.getProject(job.project_id),
      ]);

      const durationMs = summary.asset?.source_duration_ms ?? summary.asset?.duration_ms ?? null;
      if (durationMs === null) {
        throw toolError(422, 'duration_unknown', 'Project source audio duration is unavailable.');
      }
      if (summary.asset?.id !== result.binding.asset_id) {
        throw toolError(
          409,
          'source_asset_changed',
          'Project source audio changed after the alignment job was submitted. Run preview_alignment and start_alignment again.',
        );
      }

      if (expected_revision && expected_revision !== result.binding.revision) {
        throw toolError(
          412,
          'revision_conflict',
          `Alignment result is bound to revision "${result.binding.revision}", which does not match expected_revision "${expected_revision}". Re-preview and re-run alignment.`,
          { params: { bound_revision: result.binding.revision, expected_revision } },
        );
      }

      const clearUnmatched =
        clear_unmatched ??
        job.request.clear_unmatched as boolean;
      const mergeShortGaps =
        merge_short_gaps ??
        job.request.merge_short_gaps as boolean;
      const thresholdMs =
        gap_threshold_ms ??
        job.request.gap_threshold_ms as number;

      type AlignmentMutation = MutationResult<{
        cleared_count: number;
        retained_count: number;
        merged_gaps: number;
      }>;
      let mutation = idempotency?.checkpoint as AlignmentMutation | undefined;
      if (!mutation) {
        mutation = await mutateProjectDocument(
          client,
          job.project_id,
          {
            expectedRevision: result.binding.revision,
            idempotencyKey: idempotency_key,
          },
          (doc) => {
            const merged = mergeAlignment(
              doc,
              result,
              durationMs,
              clearUnmatched,
              mergeShortGaps ? thresholdMs : null,
            );
            if (merged.project !== doc) {
              validateProjectEditing(merged.project.lyrics, merged.project.editing);
              assertAmll(merged.project.lyrics, merged.project.amll);
            }
            return {
              nextDoc: merged.project,
              summary: {
                cleared_count: merged.cleared.length,
                retained_count: merged.retained.length,
                merged_gaps: merged.mergedGaps,
              },
            };
          },
        );
        idempotency?.saveCheckpoint(mutation);
      }

      await client.acknowledgeJob(job_id, 'applied');

      return {
        ...mutation,
        job_id,
        acknowledged_state: 'applied',
        normalization: result.normalization ?? null,
      };
    },
  });
}
