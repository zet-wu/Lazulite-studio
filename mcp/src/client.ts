import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { ProjectSnapshot } from '../../frontend/src/domain/project-document';

export type StudioIdentity = {
  nonce?: string;
  library_id?: string;
  data_dir?: string;
  port: number;
  pid?: number;
  version?: string;
  target?: string;
};

export type StudioAsset = {
  schema_version: string;
  id: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  duration_ms: number | null;
  source_duration_ms: number | null;
  status: string;
  asset_hash: string;
  source_start_ms: number;
  proxy_offset_ms: number;
};

export type StudioProjectListItem = {
  schema_version: string;
  id: string;
  name: string;
  updated_at: string;
};

export type StudioProjectList = {
  schema_version: string;
  items: StudioProjectListItem[];
  next_cursor: string | null;
};

export type StudioProjectSummary = {
  schema_version: string;
  id: string;
  name: string;
  updated_at: string;
  asset: StudioAsset | null;
  music_cleanup_pending?: boolean;
};

export type StudioDocumentEnvelope = {
  schema_version: string;
  project_id: string;
  revision: string;
  etag?: string;
  document: ProjectSnapshot;
  source_asset_id: string | null;
};

export type StudioCapabilities = {
  schema_version: string;
  items: Array<{
    id: string;
    enabled: boolean;
    reason: string | null;
    reason_code?: string | null;
  }>;
};

export type StudioJob = {
  schema_version: string;
  id: string;
  project_id: string;
  kind: string;
  status: string;
  stage: string | null;
  progress?: number | null;
  acknowledged_state?: 'applied' | 'dismissed' | null;
  request: Record<string, unknown>;
  result_available: boolean;
  error: {
    code?: string;
    message?: string;
    cpu_retry?: boolean;
    stage?: string;
  } | null;
  engine: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

export type AlignmentCatalogItem = {
  id: string | null;
  name: string;
  type: string | null;
  status: string;
  reason?: string;
};

export type AlignmentCatalog = {
  directory: string;
  source: string;
  editable: boolean;
  error: string | null;
  items: AlignmentCatalogItem[];
};

export type AlignmentPreviewSummary = {
  model_preview: string;
  line_count: number;
  skipped_count: number;
  unknown_count: number;
  hint_count: number;
  emitting_count: number;
  unknown_objects?: string[];
  input_version?: string;
  inputs?: Array<{ unit_id: string; object_id: string; problem: string | null; unknown_characters: string[]; [key: string]: unknown }>;
};

export type AlignmentOptions = {
  audio_source: 'vocals' | 'original';
  crop_vocals: boolean;
  scope_ids: string[] | null;
  convert_particles: boolean;
  latin_normalize: boolean;
  strip_tone_digits: boolean;
  model_preview: string;
  use_hints: boolean;
  line_blank: boolean;
  rest_blank: boolean;
  rest_token: boolean;
  clear_unmatched: boolean;
  smart_extend: boolean;
  merge_short_gaps: boolean;
  gap_threshold_ms: number;
};

export type StudioSearchConditions = {
  title: string;
  artist: string;
  album: string;
};

export type StudioSourceMetadata = {
  asset_id: string;
  conditions: StudioSearchConditions;
};

export type OnlineLyricSource = 'netease' | 'qqmusic' | 'kugou' | 'amll';

export type OnlineLyricCandidate = {
  source: OnlineLyricSource;
  id: string;
  title: string;
  artists: string[];
  album: string;
  duration_ms: number | null;
  songmid?: string | null;
  songid?: string | null;
  platform?: string | null;
  file?: string | null;
};

export type OnlineLyricPayload = {
  empty: boolean;
  format?: 'ttml' | 'lrc' | 'elrc' | 'eslrc' | 'qrc' | 'krc' | 'yrc' | 'lys';
  content?: string;
  metadata?: Record<string, string[]>;
  translation?: string;
  romanization?: string;
  partial?: boolean;
};

export type EmbeddedLyricCandidate = {
  id: string;
  label: string;
  format?: 'ttml' | 'lrc' | 'elrc' | 'eslrc';
  content?: string;
  error?: string;
  error_code?: string;
  raw_text_preview?: string;
  raw_text_length?: number;
  raw_text?: string;
};

export type JapaneseReadingRange = {
  line_id: string;
  base_start: number;
  base_end: number;
  base: string;
  reading: string;
};

export type DictionaryInfo = {
  id: string;
  instance: string;
  manifest: Record<string, unknown> | null;
  sources: unknown;
  error: string | null;
};

export type DictionaryRange = {
  alternatives?: string[][] | null;
  line_id: string;
  base_start: number;
  base_end: number;
  base: string;
  status: 'known' | 'unknown' | 'ambiguous' | 'boundary' | 'unannotated';
  units: string[];
};

export type DictionaryAnalysis = {
  instance: string;
  version: string;
  ranges: DictionaryRange[];
};

export type StudioErrorBody = {
  code: string;
  message: string;
  retryable: boolean;
  request_id?: string;
  reason?: string;
  params?: Record<string, unknown>;
  current_revision?: string | null;
};

export class StudioHttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: StudioErrorBody,
  ) {
    super(body.message);
    this.name = 'StudioHttpError';
  }
}

export type StudioClientOptions = {
  baseUrl?: string;
  identityFile?: string;
  dataDir?: string;
  password?: string;
  fetchImpl?: typeof fetch;
};

function readIdentityFile(path: string): StudioIdentity | null {
  if (!existsSync(path)) return null;
  const raw = JSON.parse(readFileSync(path, 'utf-8')) as Partial<StudioIdentity>;
  if (typeof raw.port !== 'number' || !Number.isInteger(raw.port) || raw.port < 1 || raw.port > 65535) {
    throw new Error(`Invalid Studio identity file (missing valid port): ${path}`);
  }
  return raw as StudioIdentity;
}

export function discoverStudioBaseUrl(options: Pick<StudioClientOptions, 'baseUrl' | 'identityFile' | 'dataDir'> = {}): {
  baseUrl: string;
  source: string;
} {
  const explicitUrl = options.baseUrl ?? process.env.STUDIO_URL;
  if (explicitUrl?.trim()) {
    return { baseUrl: explicitUrl.trim().replace(/\/+$/, ''), source: 'configured' };
  }

  const explicitIdentity = options.identityFile ?? process.env.STUDIO_IDENTITY_FILE;
  if (explicitIdentity?.trim()) {
    const identity = readIdentityFile(explicitIdentity.trim());
    if (!identity) {
      throw new Error(`Studio identity file not found: ${explicitIdentity}`);
    }
    return { baseUrl: `http://127.0.0.1:${identity.port}`, source: explicitIdentity.trim() };
  }

  const candidates: string[] = [];
  const dataDir = options.dataDir ?? process.env.STUDIO_DATA_DIR;
  if (dataDir?.trim()) {
    candidates.push(resolve(dataDir.trim(), 'runtime/identity.json'));
  }
  const cwd = process.cwd();
  candidates.push(
    resolve(cwd, 'data/runtime/identity.json'),
    resolve(cwd, '../data/runtime/identity.json'),
    resolve(cwd, '../../data/runtime/identity.json'),
    resolve(cwd, 'server/data/runtime/identity.json'),
  );
  if (process.argv[1]) {
    const entryDir = dirname(resolve(process.argv[1]));
    candidates.push(
      resolve(entryDir, 'data/runtime/identity.json'),
      resolve(entryDir, '../data/runtime/identity.json'),
      resolve(entryDir, '../../data/runtime/identity.json'),
    );
  }

  for (const candidate of candidates) {
    const identity = readIdentityFile(candidate);
    if (identity) {
      return { baseUrl: `http://127.0.0.1:${identity.port}`, source: candidate };
    }
  }

  return { baseUrl: 'http://127.0.0.1:15173', source: 'default' };
}

function parseErrorBody(raw: unknown, status: number, requestId: string): StudioErrorBody {
  const envelope = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const data = envelope.detail && typeof envelope.detail === 'object'
    ? (envelope.detail as Record<string, unknown>)
    : envelope;
  return {
    code: typeof data.code === 'string' ? data.code : 'http_error',
    message: typeof data.message === 'string'
      ? data.message
      : typeof envelope.detail === 'string'
        ? envelope.detail
        : `HTTP ${status}`,
    retryable: typeof data.retryable === 'boolean' ? data.retryable : status >= 500,
    request_id: typeof data.request_id === 'string' ? data.request_id : requestId,
    ...(typeof data.reason === 'string' ? { reason: data.reason } : {}),
    ...(data.params && typeof data.params === 'object' && !Array.isArray(data.params)
      ? { params: data.params as Record<string, unknown> }
      : {}),
    ...('current_revision' in data
      ? { current_revision: typeof data.current_revision === 'string' ? data.current_revision : null }
      : {}),
  };
}

export class StudioClient {
  private readonly fetchImpl: typeof fetch;
  private readonly options: StudioClientOptions;
  private sessionCookie = '';
  private csrfToken = '';

  constructor(options: StudioClientOptions = {}) {
    this.options = options;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
  }

  resolveBaseUrl(): string {
    return discoverStudioBaseUrl(this.options).baseUrl;
  }

  private get password(): string | undefined {
    return this.options.password ?? process.env.STUDIO_PASSWORD;
  }

  private updateCookies(response: Response): void {
    const headerAccessor = response.headers as Headers & { getSetCookie?: () => string[] };
    const setCookies = typeof headerAccessor.getSetCookie === 'function'
      ? headerAccessor.getSetCookie()
      : (() => {
          const single = response.headers.get('set-cookie');
          return single ? [single] : [];
        })();
    for (const cookieLine of setCookies) {
      const pair = cookieLine.split(';', 1)[0]?.trim();
      if (!pair) continue;
      const eq = pair.indexOf('=');
      if (eq <= 0) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (name === 'studio_session') this.sessionCookie = value;
      if (name === 'studio_csrf') this.csrfToken = value;
    }
  }

  private async loginIfConfigured(baseUrl: string): Promise<boolean> {
    const password = this.password;
    if (!password) return false;
    const response = await this.fetchImpl(`${baseUrl}/api/v1/session`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Request-ID': crypto.randomUUID(),
      },
      body: JSON.stringify({ password }),
    });
    if (!response.ok) {
      let body: unknown;
      try { body = await response.json(); } catch { /* ignore */ }
      throw new StudioHttpError(response.status, parseErrorBody(body, response.status, response.headers.get('X-Request-ID') ?? ''));
    }
    this.updateCookies(response);
    return true;
  }

  async request(path: string, init: RequestInit = {}, allowRelogin = true): Promise<Response> {
    const baseUrl = this.resolveBaseUrl();
    const headers = new Headers(init.headers);
    if (!headers.has('X-Request-ID')) {
      headers.set('X-Request-ID', crypto.randomUUID());
    }
    const cookies: string[] = [];
    if (this.sessionCookie) cookies.push(`studio_session=${this.sessionCookie}`);
    if (this.csrfToken) {
      cookies.push(`studio_csrf=${this.csrfToken}`);
      if (!headers.has('X-CSRF-Token')) {
        headers.set('X-CSRF-Token', decodeURIComponent(this.csrfToken));
      }
    }
    if (cookies.length && !headers.has('Cookie')) {
      headers.set('Cookie', cookies.join('; '));
    }

    const response = await this.fetchImpl(`${baseUrl}/api/v1${path}`, {
      ...init,
      headers,
    });
    if (response.status === 401 && allowRelogin && (await this.loginIfConfigured(baseUrl))) {
      return this.request(path, init, false);
    }
    if (!response.ok) {
      let body: unknown;
      try { body = await response.json(); } catch { /* ignore */ }
      throw new StudioHttpError(response.status, parseErrorBody(body, response.status, response.headers.get('X-Request-ID') ?? ''));
    }
    return response;
  }

  async json<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await this.request(path, init);
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  listProjects(cursor?: string, limit = 50): Promise<StudioProjectList> {
    const params = new URLSearchParams({ limit: String(limit) });
    if (cursor) params.set('cursor', cursor);
    return this.json<StudioProjectList>(`/projects?${params.toString()}`);
  }

  getProject(projectId: string): Promise<StudioProjectSummary> {
    return this.json<StudioProjectSummary>(`/projects/${encodeURIComponent(projectId)}`);
  }

  async getDocumentEnvelope(projectId: string): Promise<StudioDocumentEnvelope> {
    const response = await this.request(`/projects/${encodeURIComponent(projectId)}/document`);
    const body = (await response.json()) as StudioDocumentEnvelope;
    return {
      ...body,
      etag: response.headers.get('ETag') ?? `"${body.revision}"`,
    };
  }

  async saveDocument(
    projectId: string,
    snapshot: ProjectSnapshot,
    baseRevision: string,
    operationId: string = crypto.randomUUID(),
    etag?: string,
  ): Promise<{ revision: string; etag: string }> {
    const response = await this.request(`/projects/${encodeURIComponent(projectId)}/document`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'If-Match': etag ?? `"${baseRevision}"`,
        'Idempotency-Key': operationId,
      },
      body: JSON.stringify({
        schema_version: 'studio-document-v9',
        project_id: projectId,
        revision: baseRevision,
        document: snapshot,
      }),
    });
    const body = (await response.json()) as { revision: string };
    return {
      revision: body.revision,
      etag: response.headers.get('ETag') ?? `"${body.revision}"`,
    };
  }

  getSourceMetadata(projectId: string, tagsOnly = false): Promise<StudioSourceMetadata> {
    return this.json<StudioSourceMetadata>(
      `/projects/${encodeURIComponent(projectId)}/source-metadata${tagsOnly ? '?tags_only=true' : ''}`,
    );
  }

  getSearchConditions(projectId: string): Promise<StudioSearchConditions> {
    return this.json<StudioSearchConditions>(`/projects/${encodeURIComponent(projectId)}/search-conditions`);
  }

  listJobs(projectId: string, limit = 50): Promise<{ schema_version: string; items: StudioJob[] }> {
    return this.json(`/projects/${encodeURIComponent(projectId)}/jobs?limit=${limit}`);
  }

  getCapabilities(): Promise<StudioCapabilities> {
    return this.json<StudioCapabilities>('/capabilities');
  }

  searchOnlineLyrics(
    source: OnlineLyricSource,
    query: string,
  ): Promise<{ items: OnlineLyricCandidate[] }> {
    return this.json('/lyric-sources/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source, query }),
    });
  }

  resolveOnlineLyric(candidate: OnlineLyricCandidate): Promise<OnlineLyricCandidate> {
    return this.json('/lyric-sources/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(candidate),
    });
  }

  fetchOnlineLyric(candidate: OnlineLyricCandidate): Promise<OnlineLyricPayload> {
    return this.json('/lyric-sources/fetch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(candidate),
    });
  }

  getEmbeddedLyrics(projectId: string): Promise<{ candidates: EmbeddedLyricCandidate[] }> {
    return this.json(`/projects/${encodeURIComponent(projectId)}/embedded-lyrics`);
  }

  analyzeJapaneseReading(
    lines: Array<{ id: string; text: string }>,
    autoMerge = false,
  ): Promise<{ ranges: JapaneseReadingRange[] }> {
    return this.json('/reading/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lines, auto_merge: autoMerge }),
    });
  }

  listDictionaries(): Promise<{ dictionaries: DictionaryInfo[]; errors: string[] }> {
    return this.json('/reading/dictionaries');
  }

  analyzeDictionaryReading(
    id: string,
    instance: string,
    lines: Array<{ id: string; text: string }>,
  ): Promise<DictionaryAnalysis> {
    return this.json(`/reading/dictionaries/${encodeURIComponent(id)}/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instance, lines }),
    });
  }

  listAlignmentModels(refresh = false): Promise<AlignmentCatalog> {
    return this.json(`/alignment-models?refresh=${refresh}`);
  }

  previewAlignment(
    projectId: string,
    revision: string,
    model: string,
    options: Pick<AlignmentOptions, 'convert_particles' | 'latin_normalize' | 'strip_tone_digits'> & {scope_ids?:string[]|null},
  ): Promise<AlignmentPreviewSummary> {
    const query = new URLSearchParams({
      revision,
      model,
      convert_particles: String(options.convert_particles),
      latin_normalize: String(options.latin_normalize),
      strip_tone_digits: String(options.strip_tone_digits),
    });
    for (const id of options.scope_ids ?? []) query.append('scope_ids',id);
    return this.json(`/projects/${encodeURIComponent(projectId)}/alignment-preview?${query.toString()}`);
  }

  startAlignment(
    projectId: string,
    revision: string,
    options: AlignmentOptions,
    idempotencyKey: string = crypto.randomUUID(),
  ): Promise<StudioJob> {
    return this.json(`/projects/${encodeURIComponent(projectId)}/jobs/alignment`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify({ params: { revision, ...options } }),
    });
  }

  getJob(jobId: string): Promise<StudioJob> {
    return this.json(`/jobs/${encodeURIComponent(jobId)}`);
  }

  cancelJob(jobId: string): Promise<StudioJob> {
    return this.json(`/jobs/${encodeURIComponent(jobId)}/cancel`, {
      method: 'POST',
    });
  }

  acknowledgeJob(jobId: string, state: 'applied' | 'dismissed'): Promise<StudioJob> {
    return this.json(`/jobs/${encodeURIComponent(jobId)}/acknowledge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state }),
    });
  }

  getJobResult<T = Record<string, unknown>>(jobId: string): Promise<T & { schema_version: string; job_id: string }> {
    return this.json(`/jobs/${encodeURIComponent(jobId)}/result`);
  }
}
