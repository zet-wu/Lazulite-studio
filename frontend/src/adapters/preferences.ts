import {message, MessageError, errorMessage} from '../domain/messages';
import { requestHeaders } from './http/client';

type Preferences = { version: number; revision: number; library_id: string; values: Record<string, string> };
let current: Preferences | null = null;
let pending = Promise.resolve();
export const libraryIdentity = () => current?.library_id ?? 'legacy';
export const scopedSessionKey = (key: string) => `${libraryIdentity()}:${key}`;

async function read(): Promise<Preferences> {
  const response = await fetch('/api/v1/settings', { headers: requestHeaders(), cache: 'no-store' });
  if (!response.ok) throw new MessageError(message('preferences.portableReadFailed'));
  const value = await response.json() as Preferences;
  if (value.version !== 1 || !/^[a-f0-9]{32}$/.test(value.library_id) || !value.values || !Number.isInteger(value.revision)) throw new MessageError(message('preferences.invalidResponse'));
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
    window.dispatchEvent(new Event('studio-preference-change'));
    return Promise.resolve();
  }
  const before = current.values[key];
  if ((value ?? undefined) === before) return pending;
  if (value === null) delete current.values[key]; else current.values[key] = value;
  window.dispatchEvent(new Event('studio-preference-change'));
  const operation = pending.then(async () => {
    // Read a fresh version so disjoint changes in other tabs are preserved.
    const latest = await read();
    if (latest.values[key] !== before && latest.values[key] !== (value ?? undefined)) throw new MessageError(message('preferences.changed'));
    const response = await patch(latest, { [key]: value });
    if (!response.ok) throw new MessageError(message(response.status===409?'preferences.conflict':'preferences.saveFailed'));
    const saved = await response.json() as Preferences;
    if (current) current.revision = saved.revision;
  }).catch(error => {
    if (current && current.values[key] === (value ?? undefined)) {
      if (before === undefined) delete current.values[key]; else current.values[key] = before;
    }
    window.dispatchEvent(new Event('studio-preference-change'));
    throw error;
  });
  pending = operation.catch((error: unknown) => {
    window.dispatchEvent(new CustomEvent('studio-preference-error', { detail: errorMessage(error) }));
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
    if(!response.ok)throw new MessageError(message('preferences.initUnsaved'));
    current=await response.json() as Preferences;return current.values[key];
  }
  throw new MessageError(message('preferences.initConflict'));
}
export function writeLibraryPreference(key:string,value:string):Promise<void> {
  const operation=pending.then(async()=>{
    for(let attempt=0;attempt<4;attempt++) {
      const latest=await read();
      const response=await patch(latest,{[key]:value});
      if(response.status===409)continue;
      if(!response.ok)throw new MessageError(message('preferences.saveFailed'));
      const saved=await response.json() as Preferences;
      if(current){current.revision=saved.revision;current.values[key]=saved.values[key];}else current=saved;
      return;
    }
    throw new MessageError(message('preferences.saveConflict'));
  });
  pending=operation.catch(()=>undefined);
  return operation;
}
