import { ApiError, requestHeaders } from "./client";

export type PackagingTrack = {
  track_id: number;
  language: string;
  name: string;
};

export type PackagingInfo = {
  filename: string;
  format_label: string;
  asset_id: string;
  supported: boolean;
  container: string | null;
  tracks: PackagingTrack[];
  error: string | null;
};

export type PackagingDownloadOptions = {
  revision: string;
  asset_id: string;
  stpp_action: "none" | "add" | "overwrite";
  target_track_id: number | null;
  lrc_kind: "none" | "lrc" | "elrc";
  lrc_text: string | null;
};

const root = "/api/v1";
const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object";

const parseFilename = (disposition: string | null): string => {
  if (!disposition) return "audio";
  const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch {
      return utf8Match[1];
    }
  }
  const plainMatch = disposition.match(/filename="?([^";]+)"?/i);
  return plainMatch ? plainMatch[1] : "audio";
};

const throwHttpError = async (response: Response, fallbackMessage: string): Promise<never> => {
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    /* ignore non-JSON body */
  }
  const detail = isObject(body) && isObject(body.detail) ? body.detail : body;
  throw new ApiError(response.status, {
    code: isObject(detail) && typeof detail.code === "string" ? detail.code : "packaging_failed",
    message: isObject(detail) && typeof detail.message === "string" ? detail.message : fallbackMessage,
    request_id: isObject(body) && typeof body.request_id === "string" ? body.request_id : "",
    retryable: response.status >= 500,
  });
};

export const publishingApi = {
  info: async (projectId: string): Promise<PackagingInfo> => {
    const response = await fetch(`${root}/projects/${encodeURIComponent(projectId)}/packaging`, {
      credentials: "include",
      headers: requestHeaders(),
    });
    if (!response.ok) await throwHttpError(response, "无法读取音乐文件信息");
    return (await response.json()) as PackagingInfo;
  },

  download: async (
    projectId: string,
    options: PackagingDownloadOptions,
  ): Promise<{ blob: Blob; filename: string }> => {
    const response = await fetch(
      `${root}/projects/${encodeURIComponent(projectId)}/packaging/download`,
      {
        method: "POST",
        credentials: "include",
        headers: requestHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(options),
      },
    );
    if (!response.ok) await throwHttpError(response, "音频打包失败，请重试");
    return {
      blob: await response.blob(),
      filename: parseFilename(response.headers.get("content-disposition")),
    };
  },
};
