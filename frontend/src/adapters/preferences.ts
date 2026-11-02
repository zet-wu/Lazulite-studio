import { requestHeaders } from './http/client';

type Preferences = { version: number; revision: number; library_id: string; values: Record<string, string> };
let current: Preferences | null = null;
let pending = Promise.resolve();
export const libraryIdentity = () => current?.library_id ?? 'legacy';
export const scopedSessionKey = (key: string) => `${libraryIdentity()}:${key}`;

async function read(): Promise<Preferences> {
  const response = await fetch('/api/v1/settings', { headers: requestHeaders(), cache: 'no-store' });
  if (!response.ok) throw new Error('无法读取便携偏好，请重试');
  const value = await response.json() as Preferences;
  if (value.version !== 1 || !/^[a-f0-9]{32}$/.test(value.library_id) || !value.values || !Number.isInteger(value.revision)) throw new Error('偏好响应无效');
  return value;
}
async function patch(snapshot: Preferences, changes: Record<string, string | null>) {
  return fetch('/api/v1/settings', { method: 'PATCH', headers: requestHeaders({ 'Content-Type': 'application/json', 'If-Match': `"${snapshot.revision}"` }), body: JSON.stringify({ changes }) });
}
export async function loadPreferences() {
  const value = await read();
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
  }).catch(error => {
    if (current && current.values[key] === (value ?? undefined)) {
      if (before === undefined) delete current.values[key]; else current.values[key] = before;
    }
    throw error;
  });
  pending = operation.catch((error: unknown) => {
    window.dispatchEvent(new CustomEvent('studio-preference-error', { detail: error instanceof Error ? error.message : '偏好保存失败' }));
  });
  return operation;
}

/** Uses the same library revision protocol; initialization never overwrites a winner. */
export async function ensureLibraryPreference(key:string, detected:string):Promise<string> {
  if(current?.values[key]!==undefined)return current.values[key];
  for(let attempt=0;attempt<4;attempt++) {
    const latest=await read();current=latest;
    if(latest.values[key]!==undefined)return latest.values[key];
    const response=await patch(latest,{[key]:detected});
    if(response.status===409)continue;
    if(!response.ok)throw new Error('偏好初始化尚未保存');
    current=await response.json() as Preferences;return current.values[key];
  }
  throw new Error('偏好初始化发生并发冲突');
}
export function writeLibraryPreference(key:string,value:string):Promise<void> {
  const operation=pending.then(async()=>{
    for(let attempt=0;attempt<4;attempt++) {
      const latest=await read();
      const response=await patch(latest,{[key]:value});
      if(response.status===409)continue;
      if(!response.ok)throw new Error('偏好保存失败');
      const saved=await response.json() as Preferences;
      if(current){current.revision=saved.revision;current.values[key]=saved.values[key];}else current=saved;
      return;
    }
    throw new Error('偏好保存发生并发冲突');
  });
  pending=operation.catch(()=>undefined);
  return operation;
}
