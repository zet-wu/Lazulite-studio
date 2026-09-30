import { toHiragana, toRomaji } from 'wanakana';
import type { LyricDocument, LyricLine, RomanizationContent, TimeUs } from './lyric-document';
import type { LyricCommand } from './lyric-commands';

export type RomanizationKind = 'plain' | 'timed';
export type GeneratedUnit = { key: string; wordId: string; text: string; beginUs: TimeUs; endUs: TimeUs; hint: string };
type PlainProposal = { lineId: string; kind: 'plain'; text: string; hint: string };
type TimedProposal = { lineId: string; kind: 'timed'; groups: GeneratedUnit[] };
export type RomanizationProposal = PlainProposal | TimedProposal;
type SourceUnit = GeneratedUnit & { reading: string };
const smallKana = /^[ゃゅょぁぃぅぇぉゎ]$/;
const kana = /^[ぁ-ゖァ-ヺー\s]+$/;
const yoon = /^[きぎしじちぢにひびぴみり][ゃゅょ]$/;
const converted = (reading: string) => {
  const text = toRomaji(reading);
  return text && !/[ぁ-ゖァ-ヺー]/.test(text) ? text : '';
};

function generateLine(line: LyricLine): GeneratedUnit[] {
  const sources: SourceUnit[] = line.words.flatMap(word => word.rubyUnits.length
    ? word.rubyUnits.map(unit => ({ key: unit.id, wordId: word.id, reading: unit.reading, text: '', beginUs: unit.beginUs, endUs: unit.endUs, hint: '' }))
    : [{ key: word.id, wordId: word.id, reading: word.text, text: '', beginUs: word.beginUs, endUs: word.endUs, hint: '' }]);
  // Keep an owner for every normalized kana. Unknown positions remain in the sequence
  // so neither consonant nor vowel context can cross a missing reading.
  const chars = sources.flatMap((source, owner) => {
    const normalized = source.reading.normalize('NFC');
    const reading = kana.test(normalized) ? toHiragana(normalized, { convertLongVowelMark: false }) : '\0';
    return Array.from(reading).map(char => ({ char, owner }));
  });
  const put = (owner: number, text: string, hint = '') => {
    sources[owner].text += text;
    if (hint) sources[owner].hint = hint;
  };
  const syllableAt = (index: number) => {
    let end = index + 1;
    while (end < chars.length && smallKana.test(chars[end].char)) end++;
    return { end, reading: chars.slice(index, end).map(item => item.char).join('') };
  };
  let vowel = '';
  for (let i = 0; i < chars.length;) {
    const { char, owner } = chars[i];
    if (char === '\0') { put(owner, ' ', '缺少日文假名读音'); vowel = ''; i++; continue; }
    if (/\s/.test(char)) { put(owner, char); vowel = ''; i++; continue; }
    if (char === 'ー') {
      put(owner, vowel || ' ', vowel ? '' : '长音缺少行内元音上下文'); i++; continue;
    }
    if (char === 'っ') {
      let next = i + 1;
      while (chars[next]?.char === 'っ') next++;
      const following = next < chars.length ? syllableAt(next).reading : '';
      const normal = converted(following), geminated = normal ? converted(`っ${following}`) : '';
      const consonant = normal && geminated.endsWith(normal) ? geminated.slice(0, -normal.length) : '';
      put(owner, consonant || ' ', consonant ? '' : '促音缺少行内辅音上下文');
      if (!consonant) vowel = '';
      i++; continue;
    }
    if (char === 'ん') {
      const next = chars[i + 1];
      const following = next ? syllableAt(i + 1).reading : '';
      // Source boundaries already provide a separator; apostrophes are needed
      // only when the following vowel/y syllable belongs to the same unit.
      put(owner, next?.owner === owner && /^[あいうえおやゆよ]/.test(following) ? "n'" : 'n');
      i++; continue;
    }
    const { end, reading } = syllableAt(i);
    const text = converted(reading);
    if (!text) { put(owner, ' ', '读音未得到罗马字'); vowel = ''; i = end; continue; }
    const owners = [...new Set(chars.slice(i, end).map(item => item.owner))];
    if (owners.length === 1) put(owner, text);
    else if (yoon.test(reading)) {
      put(owner, text.slice(0, -1), '特殊拗音分片');
      put(chars[end - 1].owner, converted(chars[end - 1].char), '特殊拗音分片');
    } else {
      // Foreign small vowels use the regular spelling, never the yoon cue.
      const suffix = converted(chars[end - 1].char);
      if (suffix && text.endsWith(suffix)) {
        put(owner, text.slice(0, -suffix.length) || ' ');
        put(chars[end - 1].owner, suffix);
      } else {
        put(owner, text);
        for (const other of owners.slice(1)) put(other, ' ', '组合读音需核对分片');
      }
    }
    vowel = text.match(/[aeiou](?=[^aeiou]*$)/)?.[0] ?? vowel;
    i = end;
  }
  const groups = sources.map(({ reading: _reading, ...unit }) => ({ ...unit, text: unit.text || ' ' }));
  // A separator belongs to the preceding real unit; it has no separate timing.
  return groups.map((unit, index) => ({ ...unit, text: index + 1 < groups.length && /\S$/.test(unit.text) && /^\S/.test(groups[index + 1].text) ? `${unit.text} ` : unit.text }));
}
export function proposeRomanization(document: LyricDocument, lineIds: readonly string[], kind: 'timed'): TimedProposal[];
export function proposeRomanization(document: LyricDocument, lineIds: readonly string[], kind?: 'plain'): PlainProposal[];
export function proposeRomanization(document: LyricDocument, lineIds: readonly string[], kind: RomanizationKind): RomanizationProposal[];
export function proposeRomanization(document: LyricDocument, lineIds: readonly string[], kind: RomanizationKind = 'plain'): RomanizationProposal[] {
  const selected = new Set(lineIds);
  return document.lines.filter(line => selected.has(line.id) && !line.backgroundOf).map(line => {
    const groups = generateLine(line);
    return kind === 'timed' ? { lineId: line.id, kind, groups } : { lineId: line.id, kind, text: groups.map(unit => unit.text).join('') || ' ', hint: groups.some(unit => unit.hint) ? '自动结果有空转换或特殊分片，可修正或保留' : '' };
  });
}
export type RomanizationChoices = { trackId: string | null; targets: Record<string, string> };
export function prepareRomanization(document: LyricDocument, source: LyricDocument, rows: RomanizationProposal[], choices: RomanizationChoices) {
  if (document !== source) throw new Error('文档已变化，请重新打开生成窗口');
  const track = choices.trackId === null ? null : document.romanizationTracks.find(item => item.id === choices.trackId);
  if (choices.trackId !== null && (!track || track.language !== 'ja-Latn')) throw new Error('请选择 ja-Latn 音译轨道');
  const byLine = new Map<string, RomanizationContent[]>();
  for (const content of track?.contents ?? []) { const list = byLine.get(content.lineId) ?? []; list.push(content); byLine.set(content.lineId, list); }
  const prepared = rows.flatMap(row => {
    const existing = byLine.get(row.lineId) ?? [];
    const target = choices.targets[row.lineId] ?? (existing.length ? 'skip' : 'append');
    if (target === 'skip') return [];
    if (target !== 'append' && !existing.some(content => content.id === target)) throw new Error('替换的音译内容不存在');
    return [{ row, target }];
  });
  if (!prepared.length) throw new Error('没有选择生成内容');
  return { track, prepared };
}
export function romanizationGenerationCommand(document: LyricDocument, source: LyricDocument, rows: RomanizationProposal[], choices: RomanizationChoices): LyricCommand {
  const { track, prepared } = prepareRomanization(document, source, rows, choices);
  const contents: RomanizationContent[] = prepared.map(({ row, target }) => row.kind === 'plain'
    ? { id: target === 'append' ? crypto.randomUUID() : target, lineId: row.lineId, kind: 'plain', text: row.text || ' ' }
    : { id: target === 'append' ? crypto.randomUUID() : target, lineId: row.lineId, kind: 'timed', units: row.groups.map(({ text, beginUs, endUs }) => ({ text: text || ' ', beginUs, endUs, id: crypto.randomUUID() })) });
  if (!track) {
    const trackId = crypto.randomUUID();
    return { type: 'batch', commands: [{ type: 'add-romanization-track', track: { id: trackId, language: 'ja-Latn', contents: [] } }, ...contents.map(content => ({ type: 'insert-romanization-content' as const, trackId, content }))] };
  }
  const existingIds = new Set(track.contents.map(content => content.id));
  return { type: 'batch', commands: contents.map(content => ({ type: existingIds.has(content.id) ? 'set-romanization-content' as const : 'insert-romanization-content' as const, trackId: track.id, content })) };
}
