import { apiFetch, apiJson } from "./client";

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

export const publishingApi = {
  info: (projectId: string): Promise<PackagingInfo> =>
    apiJson<PackagingInfo>(`/projects/${encodeURIComponent(projectId)}/packaging`),

  download: async (
    projectId: string,
    options: PackagingDownloadOptions,
  ): Promise<{ blob: Blob; filename: string }> => {
    const response = await apiFetch(
      `/projects/${encodeURIComponent(projectId)}/packaging/download`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(options),
      },
    );
    return {
      blob: await response.blob(),
      filename: parseFilename(response.headers.get("content-disposition")),
    };
  },
};
