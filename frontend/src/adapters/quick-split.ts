import {DEFAULT_SEGMENT_OPTIONS, type SegmentOptions} from '../domain/segmentation';
import {preferences} from './preferences';
export const quickSplitKey = 'studio:quick-split';
export function quickSplitOptions(): SegmentOptions {
  const raw = preferences.getItem(quickSplitKey);
  return {...DEFAULT_SEGMENT_OPTIONS, ...(raw ? JSON.parse(raw) : {})};
}
