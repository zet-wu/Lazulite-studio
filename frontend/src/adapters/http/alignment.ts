import { requestHeaders, readApiError } from './client';
import type { AlignmentResult } from '../../domain/alignment';
import type { Job } from './jobs';
export type AlignmentOptions = {latin_normalize:boolean; strip_tone_digits:boolean; model_preview:string; use_hints:boolean; line_blank:boolean; rest_blank:boolean; rest_token:boolean; clear_unmatched:boolean; merge_short_gaps:boolean; gap_threshold_ms:number};
export const defaultAlignmentOptions = (): AlignmentOptions => ({latin_normalize:true, strip_tone_digits:false, model_preview:'', use_hints:false, line_blank:false, rest_blank:false, rest_token:false, clear_unmatched:false, merge_short_gaps:false, gap_threshold_ms:500});
export type AlignmentCatalog = {directory:string;source:string;editable:boolean;error:string|null;items:{id:string|null;name:string;type:string|null;status:string;reason?:string}[]};
export type AlignmentSummary = {model_preview:string; line_count:number; skipped_count:number; unknown_count:number; hint_count:number; emitting_count:number};
export async function alignmentCall<T>(path: string, body?: unknown, key?: string, keepalive = false): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {method:body === undefined ? 'GET':'POST', credentials:'include', keepalive,
    headers:requestHeaders({'Content-Type':'application/json', ...(key ? {'Idempotency-Key':key}: {})}), body:body === undefined ? undefined:JSON.stringify(body)});
  if (!response.ok) throw await readApiError(response);
  const value = await response.json();
  return value as T;
}
export const alignmentApi = {
  models: (refresh=false) => alignmentCall<AlignmentCatalog>(`/alignment-models?refresh=${refresh}`),
  directory: (path:string|null) => alignmentCall<AlignmentCatalog>('/alignment-models/directory',{path}),
  preview: (pid:string, revision:string, model:string, options:AlignmentOptions) => alignmentCall<AlignmentSummary>(`/projects/${pid}/alignment-preview?${new URLSearchParams({revision,model,latin_normalize:String(options.latin_normalize),strip_tone_digits:String(options.strip_tone_digits)})}`),
  start: (pid:string, revision:string, options:AlignmentOptions, key:string) => alignmentCall<Job>(`/projects/${pid}/jobs/alignment`,{params:{revision,...options}},key),
  state: (id:string) => alignmentCall<Job>(`/jobs/${id}`),
  result: (id:string) => alignmentCall<AlignmentResult>(`/jobs/${id}/result`),
  cancel: (id:string) => alignmentCall<Job>(`/jobs/${id}/cancel`,{},undefined,true),
};
