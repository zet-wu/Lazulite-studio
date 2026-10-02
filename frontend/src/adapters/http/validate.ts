import type {
  Asset,
  Capabilities,
  DocumentShell,
  DocumentEnvelope,
  ImportProposal,
  JobList,
  ProjectList,
  ProjectSummary,
  Session,
  WaveformWindow,
} from "./client";

export const SCHEMA_VERSION = {
  session: "studio-session-v1",
  capabilities: "studio-capabilities-v1",
  project: "studio-project-v1",
  projectList: "studio-project-list-v1",
  jobList: "studio-job-list-v1",
  document: "studio-document-shell-v1",
  asset: "studio-asset-v1",
  waveform: "studio-waveform-v1",
} as const;

export function isDocumentEnvelope(value: unknown): value is DocumentEnvelope {
  return object(value) && value.schema_version === "studio-document-v3" && string(value.project_id) &&
    string(value.revision) && object(value.document) && value.document.schemaVersion === "studio-project-v1" &&
    (value.document.sourceAssetId === null || string(value.document.sourceAssetId)) && object(value.document.lyrics) && string(value.document.lyrics.draftTtml) && object(value.document.acoustics) && (value.document.acoustics.analysisId === null || string(value.document.acoustics.analysisId)) && Array.isArray(value.document.acoustics.segments) && string(value.sha256);
}
export function isImportCandidate(value: unknown): value is ImportProposal {
  return object(value) && value.schema_version === 'studio-import-v1' && string(value.project_id) && string(value.input_revision) && object(value.candidate) && Array.isArray(value.diagnostics) && value.saved === false;
}

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;
const string = (value: unknown): value is string => typeof value === "string";
const nonNegativeIntegerOrNull = (value: unknown): value is number | null =>
  value === null ||
  (typeof value === "number" && Number.isSafeInteger(value) && value >= 0);

export function isSession(value: unknown): value is Session {
  return (
    object(value) &&
    value.schema_version === SCHEMA_VERSION.session &&
    typeof value.authenticated === "boolean" &&
    (value.user === null ||
      (object(value.user) && string(value.user.id) && string(value.user.name)))
  );
}

export function isCapabilities(value: unknown): value is Capabilities {
  return (
    object(value) &&
    value.schema_version === SCHEMA_VERSION.capabilities &&
    Array.isArray(value.items) &&
    value.items.every(
      (item) =>
        object(item) &&
        string(item.id) &&
        typeof item.enabled === "boolean" &&
        (item.reason === null || string(item.reason)),
    )
  );
}

export function isProjectSummary(
  value: unknown,
): value is ProjectList["items"][number] {
  return (
    object(value) &&
    value.schema_version === SCHEMA_VERSION.project &&
    string(value.id) &&
    string(value.name) &&
    string(value.updated_at) &&
    ["empty", "draft", "ready"].includes(String(value.document_status)) &&
    (value.asset === undefined || value.asset === null || isAsset(value.asset))
  );
}

export function isProjectList(value: unknown): value is ProjectList {
  return (
    object(value) &&
    value.schema_version === SCHEMA_VERSION.projectList &&
    Array.isArray(value.items) &&
    (value.next_cursor === null || string(value.next_cursor)) &&
    value.items.every(isProjectSummary)
  );
}

export function isJobList(value: unknown): value is JobList {
  return (
    object(value) &&
    value.schema_version === SCHEMA_VERSION.jobList &&
    Array.isArray(value.items) &&
    value.items.every(
      (item) =>
        object(item) &&
        string(item.id) &&
        string(item.project_id) &&
        string(item.kind) &&
        [
          "queued",
          "running",
          "succeeded",
          "failed",
          "interrupted",
          "cancelled",
        ].includes(String(item.status)) &&
        object(item.request) &&
        typeof item.result_available === "boolean" &&
        typeof item.state_version === "number" && Number.isSafeInteger(item.state_version) && item.state_version >= 0,
    )
  );
}

export function isDocumentShell(value: unknown): value is DocumentShell {
  return (
    object(value) &&
    value.schema_version === SCHEMA_VERSION.document &&
    string(value.project_id) &&
    string(value.revision) &&
    string(value.title) &&
    string(value.language) &&
    Array.isArray(value.lines) &&
    Array.isArray(value.read_only_reasons) &&
    value.read_only_reasons.every(string) &&
    value.lines.every(
      (line) =>
        object(line) &&
        string(line.id) &&
        string(line.text) &&
        nonNegativeIntegerOrNull(line.begin_ms) &&
        nonNegativeIntegerOrNull(line.end_ms) &&
        (line.begin_ms === null ||
          line.end_ms === null ||
          line.begin_ms <= line.end_ms),
    )
  );
}

export function isApiError(
  value: unknown,
): value is {
  code: string;
  message: string;
  request_id: string;
  retryable: boolean;
} {
  return (
    object(value) &&
    string(value.code) &&
    string(value.message) &&
    string(value.request_id) &&
    typeof value.retryable === "boolean"
  );
}

export function isAsset(value: unknown): value is Asset {
  return (
    object(value) &&
    value.schema_version === SCHEMA_VERSION.asset &&
    string(value.id) &&
    string(value.filename) &&
    string(value.content_type) &&
    Number.isSafeInteger(value.size_bytes) &&
    (value.duration_ms === null ||
      (Number.isSafeInteger(value.duration_ms) &&
        Number(value.duration_ms) >= 0)) &&
    value.status === "ready" &&
    string(value.asset_hash) &&
    Number.isSafeInteger(value.source_start_ms) &&
    Number.isSafeInteger(value.proxy_offset_ms)
  );
}

export function isWaveformWindow(value: unknown): value is WaveformWindow {
  if (!object(value)) return false;
  const min = value.minimum;
  const max = value.maximum;
  const start = value.start_ms;
  const end = value.end_ms;
  const level = value.level;
  const bucket = value.bucket_ms;
  return (
    value.schema_version === SCHEMA_VERSION.waveform &&
    string(value.asset_id) &&
    string(value.asset_hash) &&
    string(value.version) &&
    typeof start === "number" &&
    typeof end === "number" &&
    Number.isSafeInteger(start) &&
    Number.isSafeInteger(end) &&
    end >= start &&
    typeof level === "number" &&
    Number.isSafeInteger(level) &&
    level >= 0 &&
    level <= 15 &&
    typeof bucket === "number" &&
    Number.isSafeInteger(bucket) &&
    bucket > 0 &&
    Array.isArray(min) &&
    Array.isArray(max) &&
    min.length === max.length &&
    min.every((peak) => typeof peak === "number" && peak >= -1 && peak <= 1) &&
    max.every(
      (peak, index) =>
        typeof peak === "number" &&
        peak >= -1 &&
        peak <= 1 &&
        peak >= (min[index] as number),
    )
  );
}
