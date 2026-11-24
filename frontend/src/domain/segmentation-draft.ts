import { type LyricWord, type RubyUnit } from './lyric-document';
import { timeEnvelope } from './lyric-commands';
import { DEFAULT_SEGMENT_OPTIONS, distributeSegmentTime } from './segmentation';
import { message, MessageError } from './messages';
import { isGraphemeBoundary } from './text-boundaries';

export const graphemes = (text: string) => Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text), part => part.segment);
export function rubyEnvelope(units: RubyUnit[]) {
  return timeEnvelope(units);
}
function withRuby(word: LyricWord, rubyUnits: RubyUnit[]): LyricWord {
  return { ...word, rubyUnits, ...rubyEnvelope(rubyUnits) };
}
export function splitRubyWord(word: LyricWord, parts: string[]): LyricWord[] {
  const total = graphemes(word.text).length;
  let position = 0, previous = 0;
  return parts.map((text, index) => {
    position += graphemes(text).length;
    const end = index === parts.length - 1 ? word.rubyUnits.length : Math.round(position / total * word.rubyUnits.length);
    const part = withRuby({ ...word, id: index ? crypto.randomUUID() : word.id, text }, word.rubyUnits.slice(previous, end));
    previous = end;
    return part;
  });
}
export function toggleSegmentBoundary(source: LyricWord, draft: LyricWord[], boundary: number): LyricWord[] {
  let offset = 0;
  const next = draft.slice();
  for (let index = 0; index < draft.length; index++) {
    const part = draft[index], end = offset + graphemes(part.text).length;
    if (boundary === end && index < draft.length - 1) {
      const right = draft[index + 1];
      next.splice(index, 2, withRuby({ ...part, text: part.text + right.text }, [...part.rubyUnits, ...right.rubyUnits]));
      break;
    }
    if (boundary > offset && boundary < end) {
      const chars = graphemes(part.text), texts = [chars.slice(0, boundary - offset).join(''), chars.slice(boundary - offset).join('')];
      next.splice(index, 1, ...(source.rubyUnits.length ? splitRubyWord(part, texts) : distributeSegmentTime(part, texts, DEFAULT_SEGMENT_OPTIONS.punctuationWeight)));
      break;
    }
    offset = end;
  }
  if (next.length === 1) return [source];
  return source.rubyUnits.length ? next : distributeSegmentTime(source, next.map(part => part.text), DEFAULT_SEGMENT_OPTIONS.punctuationWeight);
}
/** Assign selected units without changing the source sequence or any unselected owner. */
export function moveSegmentRuby(draft: LyricWord[], selected: string[], destination: number): LyricWord[] | null {
  if (!selected.length || !draft[destination]) return null;
  const units = draft.flatMap(part => part.rubyUnits);
  if (selected.some(id => !units.some(unit => unit.id === id))) return null;
  const owners = draft.flatMap((part, index) => part.rubyUnits.map(unit => selected.includes(unit.id) ? destination : index));
  if (owners.some((owner, index) => index > 0 && owner < owners[index - 1])) return null;
  if (!draft.some((part, index) => index !== destination && part.rubyUnits.some(unit => selected.includes(unit.id)))) return null;
  return draft.map((part, index) => withRuby(part, units.filter((_, unitIndex) => owners[unitIndex] === index)));
}
/** Submission boundary: preserve graphemes, exact ruby sequence/properties and its envelope. */
export function validateSegmentContent(source: LyricWord, parts: LyricWord[]) {
  let offset = 0;
  for (const part of parts) {
    offset += Array.from(part.text).length;
    if (!isGraphemeBoundary(source.text, offset)) throw new MessageError(message('command.segmentText'));
  }
  const units = parts.flatMap(part => part.rubyUnits);
  if (JSON.stringify(units) !== JSON.stringify(source.rubyUnits)) throw new MessageError(message('command.segmentNewAttributes'));
  if (source.rubyUnits.length) {
    for (const part of parts) {
      const envelope = rubyEnvelope(part.rubyUnits);
      if (part.beginMs !== envelope.beginMs || part.endMs !== envelope.endMs) throw new MessageError(message('command.segmentInterval'));
    }
  } else if (parts[0].beginMs !== source.beginMs || parts.at(-1)?.endMs !== source.endMs) throw new MessageError(message('command.segmentInterval'));
}
