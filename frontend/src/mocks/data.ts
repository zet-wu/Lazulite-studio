import type { Capabilities, DocumentShell, JobList, ProjectList, Session } from '../adapters/http/client';

export const session: Session = { schema_version: 'studio-session-v1', authenticated: true, user: { id: 'demo-user', name: 'Demo editor' } };
export const capabilities: Capabilities = {
  schema_version: 'studio-capabilities-v1',
  items: [
    { id: 'project.read', enabled: true, reason: null },
    { id: 'document.edit', enabled: false, reason: '歌词编辑尚未开放' },
    { id: 'job.run', enabled: false, reason: '任务执行服务尚未连接' },
  ],
};
export const sampleProject = { schema_version: 'studio-project-v1' as const, id: 'sample-project', name: '星の手紙 · 合成示例', updated_at: '2026-09-06T00:00:00Z', document_status: 'draft' as const };
export const projects: ProjectList = {
  schema_version: 'studio-project-list-v1',
  items: [sampleProject],
  next_cursor: null,
};
export const jobs: JobList = { schema_version: 'studio-job-list-v1', items: [{ id: 'sample-job', kind: 'alignment-preview', status: 'succeeded', stage: null, completed: null, total: null }] };
export const document: DocumentShell = {
  schema_version: 'studio-document-shell-v1', project_id: 'sample-project', revision: 'sample-r1', title: '星の手紙 · 合成歌词', language: 'ja', read_only_reasons: ['歌词编辑尚未开放'],
  lines: [
    { id: 'line-1', text: '夜の風が静かに吹く', begin_us: 0, end_us: 3_400_000 },
    { id: 'line-2', text: '遠い星を見上げて', begin_us: 3_600_000, end_us: 7_100_000 },
    { id: 'line-3', text: '白い月が道を照らす', begin_us: 7_300_000, end_us: 10_900_000 },
    { id: 'line-4', text: '小さな願いを抱いて', begin_us: null, end_us: null },
    { id: 'line-5', text: '朝の光へ歩き出す', begin_us: 14_000_000, end_us: 17_500_000 },
    { id: 'line-6', text: '星の手紙を胸に', begin_us: null, end_us: null },
  ],
};

export const emptyDocument: DocumentShell = { ...document, revision: 'sample-empty-r1', lines: [] };
