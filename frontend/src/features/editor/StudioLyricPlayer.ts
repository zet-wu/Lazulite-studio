import { DomLyricPlayer, type LyricLine } from '@applemusic-like-lyrics/core';

/** Keep Studio timestamps intact; only the display group's active window uses their union. */
export class StudioLyricPlayer extends DomLyricPlayer {
  constructor() {
    super();
    this.setOptimizeOptions({
      resetLineTimestamps: false,
      syncMainAndBackgroundLines: false,
      cleanUnintentionalOverlaps: false,
      tryAdvanceStartTime: false,
    });
  }

  override setLyricLines(lines: LyricLine[], initialTime = 0) {
    super.setLyricLines(lines, initialTime);
    for (const group of this.currentLyricGroups) if (group.bgLine) {
      Object.defineProperties(group, {
        startTime: { get: () => Math.min(group.mainLine.getLine().startTime, group.bgLine!.getLine().startTime) },
        endTime: { get: () => Math.max(group.mainLine.getLine().endTime, group.bgLine!.getLine().endTime) },
      });
    }
    this.setCurrentTime(initialTime, true);
  }
}
