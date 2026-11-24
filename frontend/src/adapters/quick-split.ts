import {DEFAULT_SEGMENT_OPTIONS, type SegmentOptions} from '../domain/segmentation';
import {preferences} from './preferences';
export const quickSplitKey = 'studio:quick-split';
export function quickSplitOptions(): SegmentOptions {
  const raw = preferences.getItem(quickSplitKey);
  if (!raw) return { ...DEFAULT_SEGMENT_OPTIONS };
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? { ...DEFAULT_SEGMENT_OPTIONS, ...parsed } : { ...DEFAULT_SEGMENT_OPTIONS };
  } catch {
    return { ...DEFAULT_SEGMENT_OPTIONS };
  }
}
