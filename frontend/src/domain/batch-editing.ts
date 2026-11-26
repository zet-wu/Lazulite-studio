import { readingLeaves, hasPronounceableText, closeReadingBoundary } from './reading-units';
import { message, MessageError } from './messages';
import { createProjectEditing, emptyBeatCount } from './project-editing';
import { timeEnvelope, type LyricCommand } from './lyric-commands';
import type { LyricDocument, LyricLine, LyricWord, RubyUnit, TimeMs } from './lyric-document';

const safe = (value: number) => Number.isSafeInteger(value) && value >= 0;
const cjkSyllable = (text: string) => /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+$/u.test(text);
const shifted = (value: TimeMs, delta: number): TimeMs => {
  if (value === null) return null;
  const result = value + delta;
  if (!safe(result)) throw new MessageError(message('batch.offsetOutOfRange'));
  return result;
};

export function shiftLineTimes(document: LyricDocument, lineIds: string[], deltaMs: number, _editing = createProjectEditing()): LyricCommand {
  if (!Number.isSafeInteger(deltaMs)) throw new MessageError(message('batch.integerOffset'));
  const selected = new Set(lineIds);
  const lines = document.lines.map((line): LyricLine => {
    if (!selected.has(line.id)) return line;
    return { ...line, beginMs: shifted(line.beginMs, deltaMs), endMs: shifted(line.endMs, deltaMs),
      words: line.words.map((word): LyricWord => ({ ...word, beginMs: shifted(word.beginMs, deltaMs), endMs: shifted(word.endMs, deltaMs),
        rubyUnits: word.rubyUnits.map((unit): RubyUnit => ({ ...unit, beginMs: shifted(unit.beginMs, deltaMs), endMs: shifted(unit.endMs, deltaMs) })),
      })) };
  });
  const romanizationTracks = document.romanizationTracks.map((track) => ({ ...track, contents: track.contents.map((content) =>
    selected.has(content.lineId) && content.kind === 'timed'
      ? { ...content, units: content.units.map((unit) => ({ ...unit, beginMs: shifted(unit.beginMs, deltaMs), endMs: shifted(unit.endMs, deltaMs) })) }
      : content) }));
  const translationTracks = document.translationTracks.map(track => ({ ...track, contents: track.contents.map(content => selected.has(content.lineId) && content.kind === 'timed' ? { ...content, units: content.units.map(unit => ({ ...unit, beginMs: shifted(unit.beginMs, deltaMs), endMs: shifted(unit.endMs, deltaMs) })) } : content) }));
  return { type: 'replace-document', document: { ...document, lines, romanizationTracks, translationTracks } };
}

export function smoothWordTimes(document: LyricDocument, lineIds: string[], thresholdMs: number, includeNonCjk = false): { command: LyricCommand; count: number } {
  if (!safe(thresholdMs)) throw new MessageError(message('batch.integerThreshold'));
  const selected = new Set(lineIds);
  const eligible = includeNonCjk ? hasPronounceableText : cjkSyllable;
  let count = 0;
  const lines = document.lines.map((line) => {
    if (!selected.has(line.id)) return line;
    const leaves = readingLeaves(line);
    let next = line;
    for (let index = 1; index < leaves.length; index++) {
      const left = leaves[index - 1], right = leaves[index];
      if (!eligible(left.text) || !eligible(right.text)) continue;
      if (left.value.endMs === null || right.value.beginMs === null || Math.abs(right.value.beginMs - left.value.endMs) > thresholdMs) continue;
      const changed = closeReadingBoundary(next, left, right);
      if (changed !== next) count++;
      next = changed;
    }
    return next;
  });
  return { command: { type: 'replace-document', document: { ...document, lines } }, count };
}

export function syncLineTimes(document: LyricDocument, lineIds: string[]): LyricCommand {
  const selected = new Set(lineIds);
  const commands = document.lines.filter((line) => selected.has(line.id)).flatMap((line) => {
    const envelope = timeEnvelope(line.words);
    if (envelope.beginMs === null && envelope.endMs === null) return [];
    return [{ type: 'set-line-time' as const, lineId: line.id, beginMs: envelope.beginMs ?? line.beginMs, endMs: envelope.endMs ?? line.endMs }];
  });
  return { type: 'batch', commands };
}

export type BatchReplacement = { command: LyricCommand; count: number; changed: number; deletedWords: number; deletedRuby: number; deletedBeats: number };

export function replaceText(document: LyricDocument, ids: string[], kind: 'words' | 'ruby', search: string, replacement: string, ignoreCase = false, editing = createProjectEditing()): BatchReplacement {
  if (!search) throw new MessageError(message('batch.emptySearch'));
  const selected = new Set(ids);
  const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(escaped, ignoreCase ? 'giu' : 'gu');
  const result: BatchReplacement = { command: { type: 'batch', commands: [] }, count: 0, changed: 0, deletedWords: 0, deletedRuby: 0, deletedBeats: 0 };
  const commands: Extract<LyricCommand, { type: 'batch' }>['commands'] = [];
  for (const line of document.lines) for (const word of line.words) {
    const objects = kind === 'words' ? [{ id: word.id, text: word.text }] : word.rubyUnits.map(unit => ({ id: unit.id, text: unit.reading }));
    for (const object of objects) {
      if (!selected.has(object.id)) continue;
      const matches = object.text.match(pattern);
      if (!matches?.length) continue;
      const next = object.text.replace(pattern, () => replacement);
      result.count += matches.length;
      if (next === object.text) continue;
      result.changed++;
      if (!next) {
        if (kind === 'words') { result.deletedWords++; result.deletedRuby += word.rubyUnits.length; result.deletedBeats += emptyBeatCount(editing, word.id) + word.rubyUnits.reduce((sum, unit) => sum + emptyBeatCount(editing, unit.id), 0); }
        else { result.deletedRuby++; result.deletedBeats += emptyBeatCount(editing, object.id); }
      }
      commands.push(kind === 'words'
        ? next ? { type: 'edit-word', lineId: line.id, wordId: word.id, text: next } : { type: 'delete-word', lineId: line.id, wordId: word.id }
        : next ? { type: 'edit-ruby', lineId: line.id, wordId: word.id, rubyId: object.id, reading: next } : { type: 'delete-ruby', lineId: line.id, wordId: word.id, rubyId: object.id });
    }
  }
  result.command = { type: 'batch', commands };
  return result;
}
export function clearRuby(document: LyricDocument, wordIds: string[], editing = createProjectEditing()) {
  const words = document.lines.flatMap(line => line.words.filter(word => wordIds.includes(word.id) && word.rubyUnits.length).map(word => ({ line, word })));
  return { words: words.length, ruby: words.reduce((sum, { word }) => sum + word.rubyUnits.length, 0),
    beats: words.reduce((sum, { word }) => sum + word.rubyUnits.reduce((n, unit) => n + emptyBeatCount(editing, unit.id), 0), 0),
    command: { type: 'batch', commands: words.flatMap(({ line, word }) => word.rubyUnits.map(unit => ({ type: 'delete-ruby', lineId: line.id, wordId: word.id, rubyId: unit.id }))) } as LyricCommand };
}
