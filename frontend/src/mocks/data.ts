import type {
  Capabilities,
  DocumentEnvelope,
  JobList,
  ProjectList,
  Session,
} from "../adapters/http/client";
import type { ReadingDictionary } from "../adapters/http/reading";

export const session: Session = {
  schema_version: "studio-session-v1",
  authenticated: true,
  user: { id: "demo-user", name: "Demo editor" },
};
export const capabilities: Capabilities = {
  schema_version: "studio-capabilities-v1",
  items: [
    { id: "project.read", enabled: true, reason: null },
    { id: "document.edit", enabled: true, reason: null },
    { id: "job.run", enabled: true, reason: null },
    { id: "publish.stpp", enabled: true, reason: null },
  ],
};
export const sampleProject = {
  schema_version: "studio-project-v1" as const,
  id: "sample-project",
  name: "星の手紙 · 合成示例",
  updated_at: "2026-09-06T00:00:00Z",
  asset: {
    schema_version: "studio-asset-v1" as const,
    id: "sample-asset",
    filename: "hoshi.m4a",
    content_type: "audio/mp4",
    size_bytes: 1024,
    duration_ms: 120000,
    status: "ready" as const,
    asset_hash: "demo-hash",
    source_start_ms: 0,
    proxy_offset_ms: 0,
  },
};
export const exports = {
  schema_version: "studio-export-list-v1" as const,
  items: [] as Array<Record<string, unknown>>,
};
export const projects: ProjectList = {
  schema_version: "studio-project-list-v1",
  items: [sampleProject],
  next_cursor: null,
};
export const jobs: JobList = {
  schema_version: "studio-job-list-v1",
  items: [
    {
      schema_version: "studio-job-v1",
      id: "sample-job",
      project_id: "sample-project",
      kind: "align",
      status: "succeeded",
      request: { revision: "sample-r1", asset_id: "sample-asset" },
      result_available: true,
      error: null,
      engine: null,
      created_at: "2026-09-06T00:00:00Z",
      updated_at: "2026-09-06T00:00:01Z",
      state_version: 2,
    },
  ],
};
export const document: DocumentEnvelope = {
  schema_version: "studio-document-v6",
  project_id: "sample-project",
  revision: "sample-r1",
  sha256: "demo",
  document: {
    schemaVersion: "studio-project-v4", amll: {simplified:false,noMultipleBackgrounds:true,noChorus:false,noWordAgents:true,noIndependentBackground:false}, lineOrder: [], editing: { emptyBeats: {}, ignoredSyncLineIds: [], endLinks: {} }, acoustics: { analysisId: null, segments: [] },
    lyrics: { draftTtml: '<tt xmlns="http://www.w3.org/ns/ttml"><body><div><p xml:id="line-1" begin="0s" end="5s">夜の風が静かに吹く</p><p xml:id="line-2" begin="5s" end="10s">遠い星を見上げて</p><p xml:id="line-3" begin="10s" end="15s">白い月が道を照らす</p><p xml:id="line-4" begin="15s" end="20s">小さな願いを抱いて</p><p xml:id="line-5" begin="20s" end="25s">朝の光へ歩き出す</p><p xml:id="line-6" begin="25s" end="30s">星の手紙を胸に</p></div></body></tt>' },
  },
};
export const readingDictionary: ReadingDictionary = {
  schema_version: "studio-reading-dictionary-v1",
  project_id: "sample-project",
  items: [],
};

export const emptyDocument: DocumentEnvelope = {
  ...document,
  revision: "sample-empty-r1",
  document: {
    ...document.document,
    lyrics: { draftTtml: '<tt xmlns="http://www.w3.org/ns/ttml"><body><div/></body></tt>' },
  },
};
