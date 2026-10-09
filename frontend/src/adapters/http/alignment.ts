import { requestHeaders } from './client';
import type { AlignmentResult } from '../../domain/alignment';
import type { Job } from './jobs';
export type AlignmentOptions = {use_hints:boolean; line_blank:boolean; rest_blank:boolean; rest_token:boolean};
export const defaultAlignmentOptions = (): AlignmentOptions => ({use_hints:false, line_blank:false, rest_blank:false, rest_token:false});
export type AlignmentSummary = {line_count:number; skipped_count:number; unknown_count:number; hint_count:number; emitting_count:number};
export async function alignmentCall<T>(path: string, body?: unknown, key?: string, keepalive = false): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {method:body === undefined ? 'GET':'POST', credentials:'include', keepalive,
    headers:requestHeaders({'Content-Type':'application/json', ...(key ? {'Idempotency-Key':key}: {})}), body:body === undefined ? undefined:JSON.stringify(body)});
  const value = await response.json();
  if (!response.ok) throw new Error(value.detail?.message ?? value.message ?? `对齐请求失败（${response.status}）`);
  return value as T;
}
export const alignmentApi = {
  preview: (pid:string, revision:string) => alignmentCall<AlignmentSummary>(`/projects/${pid}/alignment-preview?revision=${encodeURIComponent(revision)}`),
  start: (pid:string, revision:string, options:AlignmentOptions, key:string) => alignmentCall<Job>(`/projects/${pid}/jobs/alignment`,{params:{revision,...options}},key),
  state: (id:string) => alignmentCall<Job>(`/jobs/${id}`),
  result: (id:string) => alignmentCall<AlignmentResult>(`/jobs/${id}/result`),
  cancel: (id:string) => alignmentCall<Job>(`/jobs/${id}/cancel`,{},undefined,true),
};
