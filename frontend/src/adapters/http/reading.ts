import { requestHeaders } from "./client";

export type ReadingDictionaryEntry = {
  schema_version: "studio-reading-dictionary-entry-v1";
  project_id: string;
  id: string;
  surface: string;
  reading: string;
  updated_at: string;
};

export type ReadingDictionary = {
  schema_version: "studio-reading-dictionary-v1";
  project_id: string;
  items: ReadingDictionaryEntry[];
};

const root = "/api/v1";

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${root}${path}`, {
    credentials: "include",
    ...init,
    headers: requestHeaders({
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    }),
  });
  if (!response.ok) {
    let message = `词典请求失败（${response.status}）`;
    try {
      const body = (await response.json()) as { message?: string };
      message = body.message ?? message;
    } catch {
      /* keep the status message */
    }
    throw new Error(message);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

const projectPath = (projectId: string) =>
  `/projects/${encodeURIComponent(projectId)}/reading-dictionary`;

export const readingApi = {
  list: (projectId: string) => call<ReadingDictionary>(projectPath(projectId)),
  create: (projectId: string, surface: string, reading: string) =>
    call<ReadingDictionaryEntry>(projectPath(projectId), {
      method: "POST",
      body: JSON.stringify({ surface, reading }),
    }),
  update: (
    projectId: string,
    entryId: string,
    surface: string,
    reading: string,
  ) =>
    call<ReadingDictionaryEntry>(`${projectPath(projectId)}/${encodeURIComponent(entryId)}`, {
      method: "PUT",
      body: JSON.stringify({ surface, reading }),
    }),
  remove: (projectId: string, entryId: string) =>
    call<void>(`${projectPath(projectId)}/${encodeURIComponent(entryId)}`, {
      method: "DELETE",
    }),
};
