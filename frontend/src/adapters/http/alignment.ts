import { apiJson } from './client';
import type { AlignmentResult } from '../../domain/alignment';
import type { Job } from './jobs';
export type AlignmentOptions = {audio_source:'vocals'|'original'; crop_vocals:boolean; scope_ids:string[]|null;scope_envelope_ids:string[]|null;convert_particles:boolean; latin_normalize:boolean; strip_tone_digits:boolean; model_preview:string; use_hints:boolean; line_blank:boolean; rest_blank:boolean; rest_token:boolean; clear_unmatched:boolean; smart_extend:boolean; merge_short_gaps:boolean; gap_threshold_ms:number};
export const defaultAlignmentOptions = (): AlignmentOptions => ({audio_source:'vocals',crop_vocals:true,scope_ids:null,scope_envelope_ids:null,convert_particles:true, latin_normalize:true, strip_tone_digits:false, model_preview:'', use_hints:false, line_blank:false, rest_blank:false, rest_token:false, clear_unmatched:false, smart_extend:false, merge_short_gaps:false, gap_threshold_ms:500});
export type AlignmentCatalog = {directory:string;source:string;editable:boolean;error:string|null;items:{id:string|null;name:string;type:string|null;status:string;reason?:string}[]};
export type AlignmentSummary = {model_preview:string; line_count:number; skipped_count:number; unknown_count:number; hint_count:number; emitting_count:number};

const postJson = <T>(path: string, body: unknown, key?: string) =>
  apiJson<T>(path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) }, body: JSON.stringify(body) });

export const alignmentApi = {
  models: (refresh=false) => apiJson<AlignmentCatalog>(`/alignment-models?refresh=${refresh}`),
  directory: (path:string|null) => postJson<AlignmentCatalog>('/alignment-models/directory',{path}),
  preview: (pid:string, revision:string, model:string, options:AlignmentOptions) => {
    const query = new URLSearchParams({revision,model,convert_particles:String(options.convert_particles),latin_normalize:String(options.latin_normalize),strip_tone_digits:String(options.strip_tone_digits)});
    for (const id of options.scope_ids ?? []) query.append('scope_ids',id);
    for (const id of options.scope_envelope_ids ?? []) query.append('scope_envelope_ids',id);
    return apiJson<AlignmentSummary>(`/projects/${pid}/alignment-preview?${query}`);
  },
  start: (pid:string, revision:string, options:AlignmentOptions, key:string) => postJson<Job>(`/projects/${pid}/jobs/alignment`,{params:{revision,...options}},key),
  state: (id:string) => apiJson<Job>(`/jobs/${id}`),
  result: (id:string) => apiJson<AlignmentResult>(`/jobs/${id}/result`),
};
