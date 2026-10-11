import { normalizePlaybackSpeed } from '../domain/playback-speed';
import { preferences } from './preferences';
export const playbackSpeedKey = 'studio.playback-rate';
export function savedPlaybackSpeed() {
  const raw = preferences.getItem(playbackSpeedKey);
  const value = raw === null ? 1 : Number(raw);
  return Number.isFinite(value) && value >= .1 && value <= 2 ? normalizePlaybackSpeed(value) : 1;
}
