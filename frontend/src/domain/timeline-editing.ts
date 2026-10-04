import type { LyricDocument, LyricLine, LyricWord, RubyUnit, TimeMs } from './lyric-document';
import { shiftLineTimes } from './batch-editing';

export type TimelineTarget =
  | { kind: 'line'; lineId: string }
  | { kind: 'word'; lineId: string; wordId: string }
  | { kind: 'ruby'; lineId: string; wordId: string; rubyId: string };

const changed = (time: TimeMs, delta: number): TimeMs => {
  if (time === null) return null;
  const value = time + delta;
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('时间超出有效范围');
  return value;
};
const valid = (begin: TimeMs, end: TimeMs) => {
  for (const time of [begin, end]) if (time !== null && (!Number.isSafeInteger(time) || time < 0)) throw new Error('时间必须是非负整数毫秒');
  if (begin !== null && end !== null && begin > end) throw new Error('开始不能晚于结束');
};
const envelope = (values: TimeMs[], minimum: boolean): TimeMs => {
  const numbers = values.filter((value): value is number => value !== null);
  return numbers.length ? (minimum ? Math.min(...numbers) : Math.max(...numbers)) : null;
};
const include = (line: LyricLine, word: LyricWord): LyricLine => {
  const beginMs = envelope([line.beginMs, word.beginMs], true);
  const endMs = envelope([line.endMs, word.endMs], false);
  return { ...line, beginMs, endMs, endLink: endMs === line.endMs ? line.endLink : null };
};
const moveWord = (word: LyricWord, deltaMs: number): LyricWord => ({ ...word,
  beginMs: changed(word.beginMs, deltaMs), endMs: changed(word.endMs, deltaMs),
  rubyUnits: word.rubyUnits.map((unit) => ({ ...unit, beginMs: changed(unit.beginMs, deltaMs), endMs: changed(unit.endMs, deltaMs) })),
});

function editTarget(document: LyricDocument, target: TimelineTarget, update: (line: LyricLine) => LyricLine): LyricDocument {
  const index = document.lines.findIndex((line) => line.id === target.lineId);
  if (index < 0) throw new Error('时间轴行已不存在');
  const lines = document.lines.slice();
  lines[index] = update(lines[index]);
  return { ...document, lines };
}

export function moveTimeline(document: LyricDocument, targets: TimelineTarget[], deltaMs: number): LyricDocument {
  if (!Number.isSafeInteger(deltaMs)) throw new Error('移动量必须是整数毫秒');
  if (!targets.length || !deltaMs) return document;
  if (targets.every((target) => target.kind === 'line')) {
    const ids = new Set(targets.map((target) => target.lineId));
    for (const line of document.lines) if (line.backgroundOf && ids.has(line.backgroundOf)) ids.add(line.id);
    return (shiftLineTimes(document, [...ids], deltaMs) as Extract<ReturnType<typeof shiftLineTimes>, { type: 'replace-document' }>).document;
  }
  let result = document;
  for (const target of targets) {
    if (target.kind === 'line') throw new Error('行与子轨道不能同时移动');
    result = editTarget(result, target, (line) => {
      const index = line.words.findIndex((word) => word.id === target.wordId);
      if (index < 0) throw new Error('时间轴词已不存在');
      const words = line.words.slice();
      const word = words[index];
      if (target.kind === 'word') {
        if (word.beginMs === null || word.endMs === null) throw new Error('请先为词设置完整时间');
        words[index] = moveWord(word, deltaMs);
      } else {
        const rubyIndex = word.rubyUnits.findIndex((unit) => unit.id === target.rubyId);
        if (rubyIndex < 0) throw new Error('时间轴 注音 已不存在');
        const rubyUnits = word.rubyUnits.slice();
        const unit = rubyUnits[rubyIndex];
        if (unit.beginMs === null || unit.endMs === null) throw new Error('请先为 注音 设置完整时间');
        rubyUnits[rubyIndex] = { ...unit, beginMs: changed(unit.beginMs, deltaMs), endMs: changed(unit.endMs, deltaMs) };
        words[index] = { ...word, rubyUnits,
          beginMs: envelope(rubyUnits.map((item) => item.beginMs), true), endMs: envelope(rubyUnits.map((item) => item.endMs), false), };
      }
      return include({ ...line, words }, words[index]);
    });
  }
  return result;
}

export function resizeTimeline(document: LyricDocument, target: TimelineTarget, side: 'beginMs' | 'endMs', timeMs: number): LyricDocument {
  valid(timeMs, timeMs);
  return editTarget(document, target, (line) => {
    if (target.kind === 'line') {
      const beginMs = side === 'beginMs' ? timeMs : line.beginMs;
      const endMs = side === 'endMs' ? timeMs : line.endMs;
      valid(beginMs, endMs);
      if (line.words.some((word) => beginMs !== null && word.beginMs !== null && word.beginMs < beginMs || endMs !== null && word.endMs !== null && word.endMs > endMs)) throw new Error('行边界不能排除词');
      return { ...line, beginMs, endMs, endLink: side === 'endMs' ? null : line.endLink };
    }
    const index = line.words.findIndex((word) => word.id === target.wordId);
    if (index < 0) throw new Error('时间轴词已不存在');
    const words = line.words.slice();
    const word = words[index];
    if (target.kind === 'word') {
      const beginMs = side === 'beginMs' ? timeMs : word.beginMs;
      const endMs = side === 'endMs' ? timeMs : word.endMs;
      valid(beginMs, endMs);
      if (word.rubyUnits.some((unit) => beginMs !== null && unit.beginMs !== null && unit.beginMs < beginMs || endMs !== null && unit.endMs !== null && unit.endMs > endMs)) throw new Error('词边界不能排除 注音');
      words[index] = { ...word, beginMs, endMs };
    } else {
      const rubyIndex = word.rubyUnits.findIndex((unit) => unit.id === target.rubyId);
      if (rubyIndex < 0) throw new Error('时间轴 注音 已不存在');
      const rubyUnits = word.rubyUnits.slice();
      const unit: RubyUnit = { ...rubyUnits[rubyIndex], [side]: timeMs };
      valid(unit.beginMs, unit.endMs);
      rubyUnits[rubyIndex] = unit;
      words[index] = { ...word, rubyUnits,
        beginMs: envelope(rubyUnits.map((item) => item.beginMs), true), endMs: envelope(rubyUnits.map((item) => item.endMs), false) };
    }
    return include({ ...line, words }, words[index]);
  });
}

export function snapTime(timeMs: number, anchors: number[], toleranceMs: number): number {
  const nearest = anchors.reduce<{ value: number; distance: number } | null>((best, value) => {
    const distance = Math.abs(value - timeMs);
    return distance <= toleranceMs && (!best || distance < best.distance) ? { value, distance } : best;
  }, null);
  return nearest?.value ?? timeMs;
}

/** Shared pixel-to-time conversion for lyric and segment gestures. */
export const timelineDelta = (pixels: number, width: number, spanMs: number) => Math.round(pixels / width * spanMs);
export const snapTimelineTime = (timeMs: number, anchors: number[], spanMs: number, width: number, enabled: boolean) =>
  Math.round(enabled ? snapTime(timeMs, anchors, spanMs * 8 / width) : timeMs);
