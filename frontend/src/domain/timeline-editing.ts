import type { LyricDocument, LyricLine, LyricWord, RubyUnit, TimeUs } from './lyric-document';
import { shiftLineTimes } from './batch-editing';

export type TimelineTarget =
  | { kind: 'line'; lineId: string }
  | { kind: 'word'; lineId: string; wordId: string }
  | { kind: 'ruby'; lineId: string; wordId: string; rubyId: string };

const changed = (time: TimeUs, delta: number): TimeUs => {
  if (time === null) return null;
  const value = time + delta;
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('时间超出有效范围');
  return value;
};
const valid = (begin: TimeUs, end: TimeUs) => {
  for (const time of [begin, end]) if (time !== null && (!Number.isSafeInteger(time) || time < 0)) throw new Error('时间必须是非负整数微秒');
  if (begin !== null && end !== null && begin > end) throw new Error('开始不能晚于结束');
};
const envelope = (values: TimeUs[], minimum: boolean): TimeUs => {
  const numbers = values.filter((value): value is number => value !== null);
  return numbers.length ? (minimum ? Math.min(...numbers) : Math.max(...numbers)) : null;
};
const include = (line: LyricLine, word: LyricWord): LyricLine => {
  const beginUs = envelope([line.beginUs, word.beginUs], true);
  const endUs = envelope([line.endUs, word.endUs], false);
  return { ...line, beginUs, endUs, endLink: endUs === line.endUs ? line.endLink : null };
};
const moveWord = (word: LyricWord, deltaUs: number): LyricWord => ({ ...word,
  beginUs: changed(word.beginUs, deltaUs), endUs: changed(word.endUs, deltaUs),
  rubyUnits: word.rubyUnits.map((unit) => ({ ...unit, beginUs: changed(unit.beginUs, deltaUs), endUs: changed(unit.endUs, deltaUs) })),
  alignmentUnits: word.alignmentUnits.map((unit) => ({ ...unit, beginUs: changed(unit.beginUs, deltaUs), endUs: changed(unit.endUs, deltaUs) })),
});

function editTarget(document: LyricDocument, target: TimelineTarget, update: (line: LyricLine) => LyricLine): LyricDocument {
  const index = document.lines.findIndex((line) => line.id === target.lineId);
  if (index < 0) throw new Error('时间轴行已不存在');
  const lines = document.lines.slice();
  lines[index] = update(lines[index]);
  return { ...document, lines };
}

export function moveTimeline(document: LyricDocument, targets: TimelineTarget[], deltaUs: number): LyricDocument {
  if (!Number.isSafeInteger(deltaUs)) throw new Error('移动量必须是整数微秒');
  if (!targets.length || !deltaUs) return document;
  if (targets.every((target) => target.kind === 'line')) {
    const ids = new Set(targets.map((target) => target.lineId));
    for (const line of document.lines) if (line.backgroundOf && ids.has(line.backgroundOf)) ids.add(line.id);
    return (shiftLineTimes(document, [...ids], deltaUs) as Extract<ReturnType<typeof shiftLineTimes>, { type: 'replace-document' }>).document;
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
        if (word.beginUs === null || word.endUs === null) throw new Error('请先为词设置完整时间');
        words[index] = moveWord(word, deltaUs);
      } else {
        const rubyIndex = word.rubyUnits.findIndex((unit) => unit.id === target.rubyId);
        if (rubyIndex < 0) throw new Error('时间轴 Ruby 已不存在');
        const rubyUnits = word.rubyUnits.slice();
        const unit = rubyUnits[rubyIndex];
        if (unit.beginUs === null || unit.endUs === null) throw new Error('请先为 Ruby 设置完整时间');
        rubyUnits[rubyIndex] = { ...unit, beginUs: changed(unit.beginUs, deltaUs), endUs: changed(unit.endUs, deltaUs) };
        words[index] = { ...word, rubyUnits,
          beginUs: envelope(rubyUnits.map((item) => item.beginUs), true), endUs: envelope(rubyUnits.map((item) => item.endUs), false),
          alignmentUnits: word.alignmentUnits.map((unit) => unit.rubyUnitId === target.rubyId ? { ...unit, beginUs: changed(unit.beginUs, deltaUs), endUs: changed(unit.endUs, deltaUs) } : unit) };
      }
      return include({ ...line, words }, words[index]);
    });
  }
  return result;
}

export function resizeTimeline(document: LyricDocument, target: TimelineTarget, side: 'beginUs' | 'endUs', timeUs: number): LyricDocument {
  valid(timeUs, timeUs);
  return editTarget(document, target, (line) => {
    if (target.kind === 'line') {
      const beginUs = side === 'beginUs' ? timeUs : line.beginUs;
      const endUs = side === 'endUs' ? timeUs : line.endUs;
      valid(beginUs, endUs);
      if (line.words.some((word) => beginUs !== null && word.beginUs !== null && word.beginUs < beginUs || endUs !== null && word.endUs !== null && word.endUs > endUs)) throw new Error('行边界不能排除词');
      return { ...line, beginUs, endUs, endLink: side === 'endUs' ? null : line.endLink };
    }
    const index = line.words.findIndex((word) => word.id === target.wordId);
    if (index < 0) throw new Error('时间轴词已不存在');
    const words = line.words.slice();
    const word = words[index];
    if (target.kind === 'word') {
      const beginUs = side === 'beginUs' ? timeUs : word.beginUs;
      const endUs = side === 'endUs' ? timeUs : word.endUs;
      valid(beginUs, endUs);
      if (word.rubyUnits.some((unit) => beginUs !== null && unit.beginUs !== null && unit.beginUs < beginUs || endUs !== null && unit.endUs !== null && unit.endUs > endUs)) throw new Error('词边界不能排除 Ruby');
      words[index] = { ...word, beginUs, endUs };
    } else {
      const rubyIndex = word.rubyUnits.findIndex((unit) => unit.id === target.rubyId);
      if (rubyIndex < 0) throw new Error('时间轴 Ruby 已不存在');
      const rubyUnits = word.rubyUnits.slice();
      const unit: RubyUnit = { ...rubyUnits[rubyIndex], [side]: timeUs };
      valid(unit.beginUs, unit.endUs);
      rubyUnits[rubyIndex] = unit;
      words[index] = { ...word, rubyUnits,
        beginUs: envelope(rubyUnits.map((item) => item.beginUs), true), endUs: envelope(rubyUnits.map((item) => item.endUs), false) };
    }
    return include({ ...line, words }, words[index]);
  });
}

export function snapTime(timeUs: number, anchors: number[], toleranceUs: number): number {
  const nearest = anchors.reduce<{ value: number; distance: number } | null>((best, value) => {
    const distance = Math.abs(value - timeUs);
    return distance <= toleranceUs && (!best || distance < best.distance) ? { value, distance } : best;
  }, null);
  return nearest?.value ?? timeUs;
}
