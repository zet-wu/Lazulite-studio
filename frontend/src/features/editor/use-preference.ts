import { useState } from 'react';

// Preferences are browser UI state; never enter the lyric document or history.
export function usePreference<T extends string | number>(key: string, initial: T, valid: (value: unknown) => value is T): [T, (value: T) => void] {
  const read = () => {
    try { const value: unknown = JSON.parse(localStorage.getItem(key) ?? 'null'); return valid(value) ? value : initial; }
    catch { return initial; } // Unavailable storage or invalid external preference.
  };
  const [state, setState] = useState(() => ({ key, value: read() }));
  if (state.key !== key) setState({ key, value: read() });
  return [state.key === key ? state.value : read(), value => {
    if (!valid(value)) return;
    setState({ key, value });
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Editing remains usable when browser storage is denied. */ }
  }];
}
