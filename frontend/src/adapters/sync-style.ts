import { usePreference } from './studio-preferences';
export type SyncStyle = 'sug' | 'amll';
export function useSyncStyle(): [SyncStyle, (style: SyncStyle) => void] {
  const [value, set] = usePreference('studio:sync-style', 'sug');
  return [value === 'amll' ? 'amll' : 'sug', set];
}
