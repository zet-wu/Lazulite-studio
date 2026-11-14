import { useSyncExternalStore } from 'react';
import { preferences, savePreference } from './preferences';
import { defaultAlignmentOptions } from './http/alignment';

type Widen<T> = T extends boolean ? boolean : T extends number ? number : string;
export function usePreference<T extends string | boolean | number>(key: string, initial: T): [Widen<T>, (value: Widen<T>) => void] {
  const raw = useSyncExternalStore(subscribe, () => preferences.getItem(key));
  const value = raw === null ? initial : typeof initial === 'boolean' ? raw === 'true' : typeof initial === 'number' ? Number(raw) : raw;
  // savePreference broadcasts failures and rolls back the shared value.
  return [value as Widen<T>, next => { void savePreference(key, String(next)).catch(() => undefined); }];
}
function subscribe(listener: () => void) {
  window.addEventListener('studio-preference-change', listener);
  return () => window.removeEventListener('studio-preference-change', listener);
}
export const particlesEnabled = () => preferences.getItem('studio:convert-particles') !== 'false';
export function alignmentDefaults() {
  const defaults = defaultAlignmentOptions();
  const stored = preferences.getItem('studio:alignment-defaults');
  return {...defaults, ...(stored ? JSON.parse(stored) : {}), model_preview: '', convert_particles: particlesEnabled()};
}
export function resolveDefaultModel(items: {name:string; type:string|null; status:string; id:string|null}[]) {
  const raw = preferences.getItem('studio:alignment-model');
  if (!raw) return {id: '', missing: false};
  const stored = JSON.parse(raw) as {name:string; type:string};
  const model = items.find(item => item.name === stored.name && item.type === stored.type && item.status === 'ready');
  return {id:model?.id ?? '', missing:!model};
}
