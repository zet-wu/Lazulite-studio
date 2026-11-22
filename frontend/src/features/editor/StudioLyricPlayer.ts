import { DomLyricPlayer, type LyricLine } from '@applemusic-like-lyrics/core';

type PlayerLine = NonNullable<DomLyricPlayer['currentLyricGroups'][number]['mainLine']>;

/** Keep Studio timestamps intact; only the display group's active window uses their union. */
export class StudioLyricPlayer extends DomLyricPlayer {
  private lastTimeMs = -1;
  private lastRate = -1;
  private lastPlaying = false;
  private activeLines = new Set<PlayerLine>();

  constructor() {
    super();
    this.setOptimizeOptions({
      resetLineTimestamps: false,
      syncMainAndBackgroundLines: false,
      cleanUnintentionalOverlaps: false,
      tryAdvanceStartTime: false,
    });
  }

  /** AMLL 0.5.2 song animations use line-relative time; layout springs are untouched. */
  syncMedia(timeMs: number, rate: number, playing: boolean) {
    if (!playing && !this.lastPlaying && this.lastTimeMs === timeMs && this.lastRate === rate) return;
    this.lastTimeMs = timeMs;
    this.lastRate = rate;
    this.lastPlaying = playing;
    this.setCurrentTime(timeMs);
    for (const group of this.currentLyricGroups) {
      for (const line of [group.mainLine, group.bgLine]) {
        if (!line) continue;
        const model = line.getLine();
        const near = timeMs >= model.startTime - 500 && timeMs <= model.endTime + 500;
        if (!near && !this.activeLines.has(line)) continue;
        if (near) this.activeLines.add(line);
        else this.activeLines.delete(line);
        const relative = Math.max(0, timeMs - model.startTime);
        for (const animation of line.getElement().getAnimations({ subtree: true })) {
          if (!/^(fade-word-|float-word$|emphasize-word-)/.test(animation.id)) continue;
          // Leave AMLL's reverse exit animation running in its original direction.
          if (animation.playbackRate < 0) continue;
          const timing = animation.effect?.getComputedTiming();
          const end = Number(timing?.endTime ?? 0);
          const phase = Math.min(relative, end);
          // Align to the sole media clock, including seeks, loops and rebuilt animations.
          animation.playbackRate = rate;
          if (Math.abs(Number(animation.currentTime ?? 0) - phase) > 30 || !playing) animation.currentTime = phase;
          if (playing && relative < end && timeMs >= model.startTime) {
            if (animation.playState !== 'running') animation.play();
          } else animation.pause();
        }
      }
    }
  }

  override setLyricLines(lines: LyricLine[], initialTime = 0) {
    this.activeLines.clear();
    this.lastTimeMs = -1;
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
