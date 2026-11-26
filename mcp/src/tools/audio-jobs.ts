import { createProjectEditorState, executeProjectCommand, validateSegments } from '../../../frontend/src/domain/project-document';
import { mutateProjectDocument } from './cas';
import { z } from 'zod';
import { parseProject } from '../../../frontend/src/adapters/project-codec';
import { timeEnvelope } from '../../../frontend/src/domain/lyric-commands';
import { StudioHttpError, type StudioJob } from '../client';
import { id, invalid, requireLine, writeSchema, reference, remember } from './editing';
import { contentPayload, withOperationContext, type ToolRegistry } from './registry';
const read = { readOnlyHint: true, destructiveHint: false, idempotentHint: true };
const write = { readOnlyHint: false, destructiveHint: false, idempotentHint: false };
const projectPath = (projectId: string) => `/projects/${encodeURIComponent(projectId)}`;
type VocalResult = {
  id: string; source_asset_id: string; duration_ms: number; status: string; audio_state: string; audio_id: string;
  model_name?: string; model?: string | { name?: string; model_name?: string; model?: string };
  segments?: unknown[]; created_at?: string;
};
function post(body: unknown, key?: string): RequestInit { return { method: 'POST', headers: { 'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) }, body: JSON.stringify(body) }; }
function jobSummary(job: StudioJob) { return { job_id: job.id, project_id: job.project_id, kind: job.kind, status: job.status, stage: job.stage, acknowledged_state: job.acknowledged_state ?? null, result_available: job.result_available, error: job.error, model: job.request.model ?? job.request.model_name ?? null, devices: job.request.devices ?? null, reused_vocal: job.request.reused_vocal ?? false, bound_revision: job.request.revision ?? job.request.bound_revision ?? null, created_at: job.created_at, updated_at: job.updated_at }; }
export function registerAudioJobTools(registry: ToolRegistry) {
  registry.register({ name: 'list_vocal_models', description: 'List installed vocal separation models, availability, selected model and usable devices from the desktop backend catalog. Use the returned ID as start_vocal_separation.model_id.', annotations: read,
    inputSchema: { refresh: z.boolean().default(false) }, execute: async ({ refresh }, { client }) => client.json(`/vocal-models?refresh=${refresh}`),
  });
  registry.register({ name: 'list_vocal_results', description: 'List project vocal results. Default summary includes model name and segment count; detail=full includes configuration and segments. audio_state=current means audio is available; is_active_in_project identifies the project selection.', annotations: read,
    inputSchema: { project_id: id(), detail: z.enum(['summary', 'full']).default('summary') },
    execute: async ({ project_id, detail }, { client }) => {
      const [results, envelope] = await Promise.all([
        client.json<{ items: VocalResult[] }>(`${projectPath(project_id)}/vocals`),
        client.getDocumentEnvelope(project_id),
      ]);
      const activeId = parseProject(envelope.document).acoustics.analysisId;
      return { ...results, items: results.items.map(item => {
        const is_active_in_project = item.id === activeId;
        if (detail === 'full') return { ...item, is_active_in_project };
        return {
          id: item.id, source_asset_id: item.source_asset_id, status: item.status,
          audio_id: item.audio_id, audio_state: item.audio_state, is_active_in_project,
          duration_ms: item.duration_ms,
          model_name: item.model_name ?? (typeof item.model === 'string' ? item.model : item.model?.name ?? item.model?.model_name ?? item.model?.model ?? null),
          segment_count: Array.isArray(item.segments) ? item.segments.length : 0,
          ...(item.created_at !== undefined ? { created_at: item.created_at } : {}),
        };
      }) };
    },
  });
  registry.register({ name: 'start_vocal_separation', description: 'Start independent vocal separation using optional model_id (demucs or bs-karaoke), otherwise the desktop preference. Explicit model selection only reuses results from the same model. Reuses existing audio unless force_separation=true. Use demucs for speed or ready bs-karaoke for strong lead/backing overlap. Returns a background job immediately; poll status, then list_vocal_results(detail=full) and edit_acoustics(analysis_id,replace_segments) to select it before alignment. A busy queue is retryable.', annotations: write,
    inputSchema: { project_id: id(), force_separation: z.boolean().default(false), model_id: z.enum(['demucs','bs-karaoke']).optional(), idempotency_key: id().optional() },
    execute: async ({ project_id, force_separation, model_id, idempotency_key }, { client }) => {
      const project = await client.getProject(project_id); if (!project.asset) invalid('Upload source audio before separating vocals.');
      try { return jobSummary(await client.json<StudioJob>(`${projectPath(project_id)}/jobs/vocal`, post({ params: { asset_id: project.asset.id, force_separation, ...(model_id ? { model_id } : {}) } }, idempotency_key))); }
      catch (error) { if (error instanceof StudioHttpError && error.status === 409) { const jobs = await client.listJobs(project_id); const active = jobs.items.find(job => ['queued','running','cancel_requested'].includes(job.status)); if (active) throw new StudioHttpError(409, { code: 'job_slot_busy', message: `Wait for or cancel active job ${active.id} before starting separation.`, retryable: true, params: { active_job_id: active.id } }); } throw error; }
    },
  });
  registry.register({ name: 'list_jobs', description: 'List project background jobs, optionally filtered by kind/status. limit bounds the backend history fetched before filtering.', annotations: read,
    inputSchema: { project_id: id(), limit: z.number().int().positive().max(100).default(50), kind: z.enum(['vocal','alignment']).optional(), status: z.enum(['queued','running','cancel_requested','succeeded','failed','cancelled','interrupted']).optional() },
    execute: async ({ project_id, limit, kind, status }, { client }) => ({ items: (await client.listJobs(project_id, limit)).items.filter(job => (!kind || job.kind === kind) && (!status || job.status === status)).map(jobSummary) }),
  });
  registry.register({ name: 'retry_job_cpu', description: 'Retry a failed CPU-retryable job against its bound project revision and source. revision is required; the backend validates it atomically before creating the retry.', annotations: write,
    inputSchema: { job_id: id(), revision: id(), idempotency_key: id().optional() },
    execute: async ({ job_id, revision, idempotency_key }, { client }) => jobSummary(await client.json<StudioJob>(`/jobs/${encodeURIComponent(job_id)}/retry-cpu`, post({ revision }, idempotency_key))),
  });
  registry.register({ name: 'acknowledge_job', description: 'Explicitly mark a completed job result as applied or dismissed for desktop recovery/notification state.', annotations: write,
    inputSchema: { job_id: id(), state: z.enum(['applied','dismissed']) }, execute: async ({ job_id, state }, { client }) => jobSummary(await client.acknowledgeJob(job_id, state)),
  });
  registry.register({ name: 'get_acoustics', description: 'Read saved vocal acoustic segments, silent gaps, and optionally bounded downsampled energy. Gaps indicate model segmentation and need listening review.', annotations: read,
    inputSchema: { project_id: id(), start_ms: z.number().int().nonnegative().optional(), end_ms: z.number().int().positive().optional(), include_energy: z.boolean().default(false), vocal_result_id: id().optional(), energy_buckets: z.number().int().positive().max(500).default(100) },
    execute: async (args, { client }) => {
      const [envelope, project] = await Promise.all([client.getDocumentEnvelope(args.project_id), client.getProject(args.project_id)]), doc = parseProject(envelope.document);
      const duration = project.asset?.source_duration_ms ?? project.asset?.duration_ms ?? null;
      const start = args.start_ms ?? 0, end = args.end_ms ?? duration ?? Math.max(0,...doc.acoustics.segments.map(s => s.endMs));
      if (end < start || args.end_ms !== undefined && end <= start || duration !== null && end > duration) invalid('Acoustic time window is outside the source audio.');
      const segments = doc.acoustics.segments.filter(s => s.endMs > start && s.beginMs < end).map(s => ({ segment_id: s.id, begin_ms: s.beginMs, end_ms: s.endMs }));
      const gaps: { begin_ms: number; end_ms: number; duration_ms: number }[] = []; let cursor = start;
      for (const s of [...segments].sort((a,b) => a.begin_ms - b.begin_ms)) { const begin = Math.max(start, s.begin_ms); if (begin > cursor) gaps.push({ begin_ms: cursor, end_ms: begin, duration_ms: begin-cursor }); cursor = Math.max(cursor, Math.min(end,s.end_ms)); }
      if (end > cursor) gaps.push({ begin_ms: cursor, end_ms: end, duration_ms: end-cursor });
      let energy: unknown;
      if (args.include_energy) {
        const resultId = args.vocal_result_id ?? doc.acoustics.analysisId; if (!resultId) invalid('No acoustic analysis; separate/analyze vocals first.');
        if (end <= start) invalid('Energy requires a positive audio window.');
        energy = await client.json(`${projectPath(args.project_id)}/vocals/${encodeURIComponent(resultId)}/energy?${new URLSearchParams({ start_ms: String(start), end_ms: String(end), buckets: String(args.energy_buckets) })}`);
      }
      return { revision: envelope.revision, analysis_id: doc.acoustics.analysisId, duration_ms: duration, range_ms: [start,end], segments, gaps, gap_count: gaps.length, total_gap_ms: gaps.reduce((n,gap) => n+gap.duration_ms,0), ...(energy !== undefined ? { energy } : {}) };
    },
  });
  registry.register({name:'edit_acoustics',description:'Atomically insert/update/delete/replace saved acoustic segments using shared project commands and If-Match CAS. Times must be within source audio and segments must not overlap. Optional analysis_id selects or clears a vocal result binding; omit to preserve it. Adopt a ready result using list_vocal_results(detail=full) then replace_segments plus analysis_id; the backend verifies its source at CAS save.',annotations:write,
    inputSchema:{...writeSchema(),analysis_id:id().nullable().optional(),operations:z.array(z.discriminatedUnion('op',[
      z.object({op:z.literal('insert_segment'),begin_ms:z.number().int().nonnegative(),end_ms:z.number().int().positive(),client_ref:id().optional()}),
      z.object({op:z.literal('update_segment'),segment_id:id(),begin_ms:z.number().int().nonnegative().optional(),end_ms:z.number().int().positive().optional()}),
      z.object({op:z.literal('delete_segment'),segment_id:id()}),
      z.object({op:z.literal('replace_segments'),segments:z.array(z.object({id:id().optional(),begin_ms:z.number().int().nonnegative(),end_ms:z.number().int().positive()}))}),
    ])).min(1)},
    execute:async(args,{client})=>{
      const project=await client.getProject(args.project_id),duration=project.asset?.source_duration_ms??project.asset?.duration_ms;
      if(duration===undefined||duration===null)invalid('Source audio duration is required to edit acoustic segments.');
      return mutateProjectDocument(client,args.project_id,{expectedRevision:args.expected_revision,idempotencyKey:args.idempotency_key},(doc,envelope)=>{
        if(envelope.source_asset_id!==project.asset!.id) throw new StudioHttpError(409,{code:'source_asset_changed',message:'Source audio changed while reading its duration; reload before editing acoustic segments.',retryable:false});
        let segments=doc.acoustics.segments.map(segment=>({...segment}));const refs:Record<string,string>=Object.create(null);
        args.operations.forEach((op,index)=>withOperationContext(op,index,envelope.revision,()=>{
          if(op.op==='replace_segments')segments=op.segments.map(segment=>({id:segment.id??crypto.randomUUID(),beginMs:segment.begin_ms,endMs:segment.end_ms}));
          else if(op.op==='insert_segment'){const segment={id:crypto.randomUUID(),beginMs:op.begin_ms,endMs:op.end_ms};remember(refs,op.client_ref,segment.id);segments.push(segment);}
          else {
            const target=reference(refs,op.segment_id),segment=segments.find(segment=>segment.id===target)??invalid('Acoustic segment does not exist.');
            if(op.op==='delete_segment')segments=segments.filter(item=>item.id!==target);
            else {if(op.begin_ms!==undefined)segment.beginMs=op.begin_ms;if(op.end_ms!==undefined)segment.endMs=op.end_ms;}
          }
        }));
        validateSegments(segments);
        const sorted=[...segments].sort((a,b)=>a.beginMs-b.beginMs);
        if(sorted.some((segment,index)=>segment.endMs>duration||index>0&&sorted[index-1].endMs>segment.beginMs))invalid('Acoustic segments must stay within source duration and must not overlap.');
        const acoustics={analysisId:args.analysis_id===undefined?doc.acoustics.analysisId:args.analysis_id,segments};
        const next=JSON.stringify(acoustics)===JSON.stringify(doc.acoustics)?doc:executeProjectCommand(createProjectEditorState(doc),{type:'acoustics',acoustics}).present;
        return {nextDoc:next,summary:{created_refs:refs,segment_count:segments.length,operations_applied:args.operations.length}};
      });
    },
  });
  registry.register({ name: 'get_audio_excerpt', description: 'Return a short listening window as metadata text plus MCP audio (16kHz mono PCM WAV). Supply start_ms/end_ms or line_id with optional padding. Line windows clamp to duration and 30 seconds; explicit windows must be valid. Default source=vocal; choose original explicitly if no separated vocal is available.', annotations: read,
    inputSchema: { project_id: id(), start_ms: z.number().int().nonnegative().optional(), end_ms: z.number().int().positive().optional(), line_id: id().optional(), padding_ms: z.number().int().nonnegative().max(30000).default(500), source: z.enum(['original','vocal']).default('vocal'), vocal_result_id: id().optional() },
    execute: async (args, { client }) => {
      if (args.line_id && (args.start_ms !== undefined || args.end_ms !== undefined) || !args.line_id && (args.start_ms === undefined || args.end_ms === undefined)) invalid('Provide either line_id or both start_ms and end_ms.');
      if (args.source === 'original' && args.vocal_result_id) invalid('vocal_result_id requires source=vocal.');
      const project = await client.getProject(args.project_id); if (!project.asset) invalid('Project has no source audio.');
      let duration = project.asset.source_duration_ms ?? project.asset.duration_ms, resultId: string | undefined;
      if (args.source === 'vocal') {
        const { items } = await client.json<{ items: VocalResult[] }>(`${projectPath(args.project_id)}/vocals`);
        const result = items.find(item => (!args.vocal_result_id || item.id === args.vocal_result_id) && item.source_asset_id === project.asset!.id && item.audio_state === 'current' && ['ready','separated'].includes(item.status));
        if (!result) invalid('No available vocal result for the current source. Separate vocals first or request source=original.');
        resultId = result.id; duration = result.duration_ms;
      }
      let start = args.start_ms!, end = args.end_ms!, requested: number[];
      if (args.line_id) {
        const envelope = await client.getDocumentEnvelope(args.project_id), doc = parseProject(envelope.document), line = requireLine(doc, args.line_id);
        const times = timeEnvelope([line, ...line.words, ...line.words.flatMap(word => word.rubyUnits)]);
        if (times.beginMs === null || times.endMs === null) invalid('Line has no complete timing; provide an explicit time window.');
        requested = [times.beginMs-args.padding_ms, times.endMs+args.padding_ms];
        start = Math.max(0,requested[0]); end = Math.min(requested[1],duration ?? requested[1], start+30000);
      } else requested = [start,end];
      if (end <= start || end-start > 30000 || duration !== null && end > duration) invalid('Audio window must be within the source and at most 30 seconds.');
      const params = new URLSearchParams({ start_ms: String(start), end_ms: String(end), source_asset_id: project.asset.id }); if (resultId) params.set('vocal',resultId);
      const response = await client.request(`${projectPath(args.project_id)}/audio-excerpt?${params}`), bytes = Buffer.from(await response.arrayBuffer());
      const actual = [Number(response.headers.get('X-Actual-Start-Ms')),Number(response.headers.get('X-Actual-End-Ms'))];
      return contentPayload([{ type: 'text', text: JSON.stringify({ project_id: args.project_id, source: args.source, vocal_result_id: resultId ?? null, requested_range_ms: requested, actual_range_ms: actual, duration_ms: actual[1]-actual[0], sample_rate: 16000, channels: 1, bytes: bytes.length }) }, { type: 'audio', data: bytes.toString('base64'), mimeType: 'audio/wav' }]);
    },
  });
}
