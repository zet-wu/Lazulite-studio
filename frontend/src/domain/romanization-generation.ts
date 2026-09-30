import { toRomaji } from 'wanakana';
import type { LyricDocument, LyricLine, LyricWord, RomanizationContent, TimeUs } from './lyric-document';
import type { LyricCommand } from './lyric-commands';

export type ReadingGroup = { key: string; sourceText: string; reading: string; text: string; beginUs: TimeUs; endUs: TimeUs; context: boolean };
export type RomanizationProposal = { lineId: string; groups: ReadingGroup[] };
const kana = (text: string) => /^[ぁ-ゖァ-ヺー\s]+$/.test(text.normalize('NFC')) && /[ぁ-ゖァ-ヺー]/.test(text.normalize('NFC'));
export function romanizeReading(reading: string) {
  const normalized = reading.normalize('NFC');
  if (!kana(normalized)) throw new Error('请补全日文假名读音');
  const text = toRomaji(normalized);
  if (!text.trim() || /[ぁ-ゖァ-ヺー]/.test(text)) throw new Error('读音无法完整转换，请调整假名');
  return text;
}
const envelope = (values: TimeUs[], side: 'begin' | 'end'): TimeUs => values.some(value => value === null) ? null : (side === 'begin' ? Math.min(...values as number[]) : Math.max(...values as number[]));
function wordGroup(word: LyricWord): ReadingGroup {
  const reading = word.rubyUnits.length ? word.rubyUnits.map(unit => unit.reading).join('') : kana(word.text) ? word.text : /^\s+$/.test(word.text) ? word.text : '';
  const times = word.rubyUnits.length ? word.rubyUnits : [word];
  const text = /^\s+$/.test(reading) ? reading : kana(reading) ? toRomaji(reading.normalize('NFC')) : '';
  return { key: word.id, sourceText: word.text, reading, text, beginUs: envelope(times.map(unit => unit.beginUs), 'begin'), endUs: envelope(times.map(unit => unit.endUs), 'end'), context: false };
}
function groupsForLine(line: LyricLine): ReadingGroup[] {
  const groups: ReadingGroup[] = [];
  for (const word of line.words) {
    const next = wordGroup(word), previous = groups.at(-1);
    if (previous && kana(previous.reading) && kana(next.reading) && (/[っッんン]$/.test(previous.reading) || /^[ゃゅょぁぃぅぇぉゎャュョァィゥェォヮ]/.test(next.reading))) {
      previous.key += `:${next.key}`; previous.sourceText += next.sourceText; previous.reading += next.reading; previous.context = true;
      previous.beginUs = envelope([previous.beginUs, next.beginUs], 'begin'); previous.endUs = envelope([previous.endUs, next.endUs], 'end');
      previous.text = toRomaji(previous.reading.normalize('NFC'));
    } else groups.push(next);
  }
  return groups;
}
export function proposeRomanization(document: LyricDocument, lineIds: readonly string[]): RomanizationProposal[] {
  const selected = new Set(lineIds);
  return document.lines.filter(line => selected.has(line.id) && !line.backgroundOf).map(line => ({ lineId: line.id, groups: groupsForLine(line) }));
}

export type RomanizationChoices = {
  trackId: string | null; kind: 'plain' | 'timed';
  targets: Record<string, string>; // append, skip, or a specific existing content ID
  readings: Record<string, string>; texts: Record<string, string>; confirmed: Set<string>;
};
export function prepareRomanization(document: LyricDocument, source: LyricDocument, rows: RomanizationProposal[], choices: RomanizationChoices) {
  if (document !== source) throw new Error('文档已变化，请重新生成提案');
  const track = choices.trackId === null ? null : document.romanizationTracks.find(item => item.id === choices.trackId);
  if (choices.trackId !== null && (!track || track.language !== 'ja-Latn')) throw new Error('请选择 ja-Latn 音译轨道');
  const prepared: Array<{ lineId: string; target: string; groups: Array<{ text: string; beginUs: TimeUs; endUs: TimeUs }> }> = [];
  for (const row of rows) {
    const existing = track?.contents.filter(content => content.lineId === row.lineId) ?? [];
    const target = choices.targets[row.lineId] ?? (existing.length ? 'skip' : 'append');
    if (target === 'skip') continue;
    if (target !== 'append' && !existing.some(content => content.id === target)) throw new Error('替换的音译内容不存在');
    if (!row.groups.length) throw new Error('所选行没有可生成的正文');
    const groups = row.groups.map(group => {
      const reading = choices.readings[group.key] ?? group.reading;
      const converted = /^\s+$/.test(reading) ? reading : romanizeReading(reading);
      const text = choices.texts[group.key] ?? converted;
      if (!text) throw new Error(`「${group.sourceText}」的音译为空`);
      if (group.context && !choices.confirmed.has(group.key)) throw new Error(`请确认跨词读音「${group.reading}」`);
      return { text, beginUs: group.beginUs, endUs: group.endUs };
    });
    prepared.push({ lineId: row.lineId, target, groups });
  }
  if (!prepared.length) throw new Error('没有选择生成内容');
  return { track, prepared };
}
export function romanizationGenerationCommand(document: LyricDocument, source: LyricDocument, rows: RomanizationProposal[], choices: RomanizationChoices): LyricCommand {
  const { track, prepared } = prepareRomanization(document, source, rows, choices);
  const contents: RomanizationContent[] = prepared.map(({ lineId, target, groups }) => choices.kind === 'plain'
    ? { id: target === 'append' ? crypto.randomUUID() : target, lineId, kind: 'plain', text: groups.map(group => group.text).join('') }
    : { id: target === 'append' ? crypto.randomUUID() : target, lineId, kind: 'timed', units: groups.map(group => ({ ...group, id: crypto.randomUUID() })) });
  if (!track) {
    const trackId = crypto.randomUUID();
    return { type: 'batch', commands: [{ type: 'add-romanization-track', track: { id: trackId, language: 'ja-Latn', contents: [] } }, ...contents.map(content => ({ type: 'insert-romanization-content' as const, trackId, content }))] };
  }
  return { type: 'batch', commands: contents.map(content => ({ type: track.contents.some(item => item.id === content.id) ? 'set-romanization-content' as const : 'insert-romanization-content' as const, trackId: track.id, content })) };
}
