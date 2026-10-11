import { requestHeaders } from './http/client';

type Preferences = { version: number; revision: number; library_id: string; imported: boolean; values: Record<string, string> };
let current: Preferences | null = null;
let pending = Promise.resolve();
const globals = new Set(['lazulite-editor-theme', 'lazulite-shortcuts', 'lazulite-sync-keys', 'lazulite-editor-columns', 'lazulite-kana-highlight', 'studio.playback-rate', 'studio:sync-mode', 'studio:sync-offset']);
const allowed = (key: string) => globals.has(key) || /^(lazulite-romanization-mode|studio:sync-offset|studio:download|studio:packaging|studio:workspace-mode):project:[a-zA-Z0-9_-]+$/.test(key);
export const libraryIdentity = () => current?.library_id ?? 'legacy';
export const scopedSessionKey = (key: string) => `${libraryIdentity()}:${key}`;

async function read(): Promise<Preferences> {
  const response = await fetch('/api/v1/settings', { headers: requestHeaders(), cache: 'no-store' });
  if (!response.ok) throw new Error('无法读取便携偏好，请重试');
  const value = await response.json() as Preferences;
  if (value.version !== 1 || !/^[a-f0-9]{32}$/.test(value.library_id) || !value.values || !Number.isInteger(value.revision)) throw new Error('偏好响应无效');
  return value;
}
async function patch(snapshot: Preferences, changes: Record<string, string | null>, importLegacy = false) {
  return fetch('/api/v1/settings', { method: 'PATCH', headers: requestHeaders({ 'Content-Type': 'application/json', 'If-Match': `"${snapshot.revision}"` }), body: JSON.stringify({ changes, import_legacy: importLegacy }) });
}
export async function loadPreferences() {
  let value = await read();
  if (!value.imported) {
    const changes: Record<string, string> = {};
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && allowed(key) && localStorage.getItem(key) !== null) changes[key] = localStorage.getItem(key)!;
      }
    } catch { /* Browser preferences are optional; the service remains authoritative. */ }
    const response = await patch(value, changes, true);
    if (!response.ok && response.status !== 409) throw new Error('无法导入旧偏好');
    value = await read();
  }
  current = value;
  return value;
}

export const preferences = {
  getItem(key: string): string | null {
    if (current) return current.values[key] ?? null;
    // Component fixtures and the standalone mock application have no library.
    return localStorage.getItem(key);
  },
  setItem(key: string, value: string) { void savePreference(key, value); },
  removeItem(key: string) { void savePreference(key, null); },
};

export function savePreference(key: string, value: string | null): Promise<void> {
  if (!current) {
    if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value);
    return Promise.resolve();
  }
  const before = current.values[key];
  if ((value ?? undefined) === before) return pending;
  if (value === null) delete current.values[key]; else current.values[key] = value;
  const operation = pending.then(async () => {
    // Read a fresh version so disjoint changes in other tabs are preserved.
    const latest = await read();
    if (latest.values[key] !== before && latest.values[key] !== (value ?? undefined)) throw new Error('此偏好已在另一页面修改，请刷新后重试');
    const response = await patch(latest, { [key]: value });
    if (!response.ok) throw new Error(response.status === 409 ? '偏好发生冲突，请刷新后重试' : '偏好保存失败，请重试');
    const saved = await response.json() as Preferences;
    if (current) current.revision = saved.revision;
  });
  pending = operation.catch((error: unknown) => {
    window.dispatchEvent(new CustomEvent('studio-preference-error', { detail: error instanceof Error ? error.message : '偏好保存失败' }));
  });
  return operation;
}
