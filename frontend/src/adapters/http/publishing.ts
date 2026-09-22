import { ApiError, requestHeaders } from "./client";

export type PublishReport = {
  passed?: boolean;
  audio_streams?: number;
  audio_preserved?: boolean;
  metadata_preserved?: boolean;
  subtitle_handler?: string;
  subtitle_codec?: string;
  sample_count?: number;
  ttml_sha256?: string;
};

export type ExportItem = {
  id: string;
  revision: string;
  asset_id: string;
  status:
    | "queued"
    | "running"
    | "processing"
    | "cancel_requested"
    | "succeeded"
    | "failed"
    | "cancelled"
    | "interrupted"
    | "unavailable";
  created_at: string;
  stale: boolean;
  report: PublishReport | null;
  download_url: string | null;
  error: string | Record<string, unknown> | null;
};

type ExportList = {
  schema_version: "studio-export-list-v1";
  items: ExportItem[];
};
type PublishJob = {
  id: string;
  status?: string;
  revision?: string;
  asset_id?: string;
};
const root = "/api/v1";
const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object";
const asExport = (value: unknown): ExportItem | null => {
  if (
    !isObject(value) ||
    typeof value.id !== "string" ||
    typeof value.revision !== "string" ||
    typeof value.asset_id !== "string" ||
    typeof value.status !== "string" ||
    typeof value.created_at !== "string"
  )
    return null;
  return {
    id: value.id,
    revision: value.revision,
    asset_id: value.asset_id,
    status: value.status as ExportItem["status"],
    created_at: value.created_at,
    stale: value.stale === true,
    report: isObject(value.report) ? (value.report as PublishReport) : null,
    download_url:
      typeof value.download_url === "string" ? value.download_url : null,
    error:
      typeof value.error === "string" || isObject(value.error)
        ? value.error
        : null,
  };
};
const parse = async <T>(
  response: Response,
  validate: (value: unknown) => T | null,
): Promise<T> => {
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    /* handled below */
  }
  if (!response.ok)
    throw new ApiError(response.status, {
      code: "publish_request_failed",
      message:
        isObject(body) && typeof body.message === "string"
          ? body.message
          : "发布请求失败，请重试",
      request_id: "",
      retryable: response.status >= 500,
    });
  const value = validate(body);
  if (value === null)
    throw new ApiError(502, {
      code: "invalid_response",
      message: "发布服务返回了不支持的响应",
      request_id: "",
      retryable: false,
    });
  return value;
};

export const publishingApi = {
  list: async (projectId: string): Promise<ExportList> =>
    parse(
      await fetch(`${root}/projects/${encodeURIComponent(projectId)}/exports`, {
        credentials: "include",
        headers: requestHeaders(),
      }),
      (value) => {
        if (
          !isObject(value) ||
          value.schema_version !== "studio-export-list-v1" ||
          !Array.isArray(value.items)
        )
          return null;
        const items = value.items.map(asExport);
        return items.every((item): item is ExportItem => item !== null)
          ? { schema_version: "studio-export-list-v1", items }
          : null;
      },
    ),
  publish: async (
    projectId: string,
    revision: string,
    assetId: string,
  ): Promise<PublishJob> =>
    parse(
      await fetch(`${root}/projects/${encodeURIComponent(projectId)}/publish`, {
        method: "POST",
        credentials: "include",
        headers: requestHeaders({
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        }),
        body: JSON.stringify({ revision, asset_id: assetId }),
      }),
      (value) =>
        isObject(value) && typeof value.id === "string"
          ? {
              id: value.id,
              status:
                typeof value.status === "string" ? value.status : undefined,
              revision:
                typeof value.revision === "string" ? value.revision : undefined,
              asset_id:
                typeof value.asset_id === "string" ? value.asset_id : undefined,
            }
          : null,
    ),
};
