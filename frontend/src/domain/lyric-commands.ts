import { lineStructureIssues } from './line-structure';
import { validateTranslationTracks } from './translation-editing';
import { createLine, createWord, type LyricAgent, type LyricDocument, type LyricLine, type LyricWord, type RomanizationContent, type RomanizationTrack, type RubyUnit, type TranslationTrack, type TranslationContent, type TimeMs } from './lyric-document';
import { splitAtGrapheme } from './text-boundaries';
import { distributeRubyTime, splitReadingMora } from './ruby-editing';
import { stampSync, type SyncAction, type SyncCursor, type SyncMode } from './sync-editing';

const MAX_HISTORY = 256;

type AtomicLyricCommand =
  | { type: 'insert-line'; afterLineId: string | null; line?: LyricLine }
  | { type: 'set-background-of'; lineId: string; parentLineId: string | null }
  | { type: 'delete-line'; lineId: string }
  | { type: 'move-line'; lineId: string; afterLineId: string | null }
  | ({ type: 'split-line' } & LineSplitPlan)
  | { type: 'merge-lines'; firstLineId: string; secondLineId: string }
  | { type: 'insert-word'; lineId: string; afterWordId: string | null; word: LyricWord }
  | { type: 'delete-word'; lineId: string; wordId: string }
  | { type: 'segment-word'; lineId: string; wordId: string; words: LyricWord[] }
  | { type: 'segment-words'; changes: Array<{ lineId: string; wordId: string; words: LyricWord[] }> }
  | { type: 'merge-words'; wordIds: string[] }
  | { type: 'move-word'; lineId: string; wordId: string; toLineId: string; afterWordId: string | null }
  | { type: 'set-line-time'; lineId: string; beginMs: TimeMs; endMs: TimeMs }
  | { type: 'link-line-end'; lineId: string; targetLineId: string }
  | { type: 'unlink-line-end'; lineId: string }
  | { type: 'set-line-agents'; lineId: string; agentRefs: string[] }
  | { type: 'set-ignore-sync'; lineId: string; ignoreSync: boolean }
  | { type: 'set-translation-tracks'; tracks: TranslationTrack[]; source: TranslationTrack[] }
  | { type: 'insert-translation-content'; trackId: string; content: TranslationContent }
  | { type: 'add-romanization-track'; track: RomanizationTrack }
  | { type: 'delete-romanization-track'; trackId: string }
  | { type: 'set-romanization-track-language'; trackId: string; language: string | null }
  | { type: 'move-romanization-track'; trackId: string; direction: -1 | 1 }
  | { type: 'insert-romanization-content'; trackId: string; content: RomanizationContent }
  | { type: 'set-romanization-content'; trackId: string; content: RomanizationContent }
  | { type: 'delete-romanization-content'; trackId: string; contentId: string }
  | { type: 'move-romanization-content'; trackId: string; contentId: string; afterContentId: string | null; lineId: string }
  | { type: 'split-romanization-unit'; trackId: string; contentId: string; unitId: string; at: number }
  | { type: 'merge-romanization-units'; trackId: string; contentId: string; firstUnitId: string; secondUnitId: string }
  | { type: 'move-romanization-unit'; trackId: string; contentId: string; unitId: string; afterUnitId: string | null }
  | { type: 'set-metadata'; key: string; values: string[] }
  | { type: 'set-language'; language: string | null }
  | { type: 'set-agents'; agents: LyricAgent[] }
  | { type: 'rename-agent'; id: string; nextId: string }
  | { type: 'delete-agent'; id: string }
  | { type: 'rename-metadata'; key: string; nextKey: string }
  | { type: 'sync-stamp'; cursor: SyncCursor; action: SyncAction; timeMs: number; mode?: SyncMode }
  | { type: 'replace-document'; document: LyricDocument }
  | { type: 'split-word'; lineId: string; wordId: string; at: number; newWordId?: string }
  | { type: 'edit-word'; lineId: string; wordId: string; text: string }
  | { type: 'set-word-time'; lineId: string; wordId: string; beginMs: TimeMs; endMs: TimeMs }
  | { type: 'add-ruby'; lineId: string; wordId: string; reading: string; rubyId?: string }
  | { type: 'insert-ruby'; lineId: string; wordId: string; afterRubyId: string | null; reading: string; rubyId?: string }
  | { type: 'merge-ruby'; rubyIds: string[] }
  | { type: 'move-ruby'; lineId: string; wordId: string; rubyId: string; rubyIds?: string[]; toWordId?: string; afterRubyId: string | null }
  | { type: 'set-ruby-units'; lineId: string; wordId: string; units: RubyUnit[]; overwrite?: boolean }
  | { type: 'redistribute-ruby-time'; lineId: string; wordId: string }
  | { type: 'set-word-empty-beat'; lineId: string; wordId: string; emptyBeat: number }
  | { type: 'split-ruby'; lineId: string; wordId: string; rubyId: string; at: number; newRubyId?: string }
  | { type: 'edit-ruby'; lineId: string; wordId: string; rubyId: string; reading: string }
  | { type: 'delete-ruby'; lineId: string; wordId: string; rubyId: string }
  | { type: 'set-ruby-time'; lineId: string; wordId: string; rubyId: string; beginMs: TimeMs; endMs: TimeMs };

export type LyricCommand = AtomicLyricCommand | { type: 'batch'; commands: AtomicLyricCommand[] };
type WordCommand = Extract<AtomicLyricCommand, { type: 'split-word' | 'edit-word' | 'set-word-time' | 'add-ruby' | 'insert-ruby' | 'set-ruby-units' | 'redistribute-ruby-time' | 'set-word-empty-beat' | 'split-ruby' | 'edit-ruby' | 'delete-ruby' | 'set-ruby-time' }>;

export type LyricEditorState = { present: LyricDocument; past: LyricDocument[]; future: LyricDocument[] };

export function createLyricEditorState(document: LyricDocument): LyricEditorState {
  return { present: document, past: [], future: [] };
}

function validTime(beginMs: TimeMs, endMs: TimeMs) {
  for (const value of [beginMs, endMs]) if (value !== null && (!Number.isSafeInteger(value) || value < 0)) throw new Error('Time must be a non-negative integer or null');
  if (beginMs !== null && endMs !== null && beginMs > endMs) throw new Error('Begin time exceeds end time');
}

function splitTime(beginMs: TimeMs, endMs: TimeMs, leftLength: number, totalLength: number): TimeMs {
  if (beginMs === null || endMs === null) return null;
  return beginMs + Math.round((endMs - beginMs) * leftLength / totalLength);
}

function editWord(document: LyricDocument, lineId: string, wordId: string, update: (word: LyricWord, line: LyricLine) => LyricWord[]): LyricDocument {
  let found = false;
  const lines = document.lines.map((line) => {
    if (line.id !== lineId) return line;
    const index = line.words.findIndex((word) => word.id === wordId);
    if (index < 0) throw new Error(`Word not found: ${wordId}`);
    found = true;
    const words = line.words.slice();
    const replacement = update(words[index], line);
    if (replacement.length === 1 && replacement[0] === words[index]) return line;
    words.splice(index, 1, ...replacement);
    return { ...line, words };
  });
  if (!found) throw new Error(`Line not found: ${lineId}`);
  return lines.every((line, index) => line === document.lines[index]) ? document : { ...document, lines };
}

function updateRuby(word: LyricWord, rubyId: string, update: (unit: RubyUnit) => RubyUnit[]): LyricWord {
  const index = word.rubyUnits.findIndex((unit) => unit.id === rubyId);
  if (index < 0) throw new Error(`注音单元不存在： ${rubyId}`);
  const units = word.rubyUnits.slice();
  const replacement = update(units[index]);
  if (replacement.length === 1 && replacement[0] === units[index]) return word;
  units.splice(index, 1, ...replacement);
  return { ...word, rubyUnits: units };
}

function lineIndex(document: LyricDocument, id: string): number {
  const index = document.lines.findIndex((line) => line.id === id);
  if (index < 0) throw new Error(`Line not found: ${id}`);
  return index;
}

function afterLineGroup(lines: LyricLine[], id: string): number {
  const index = lines.findIndex((line) => line.id === id);
  if (index < 0) throw new Error(`Line not found: ${id}`);
  const line = lines[index];
  if (line.backgroundOf) throw new Error('Use the parent line as the insertion anchor');
  const background = lines.findIndex((item) => item.backgroundOf === id);
  return background >= 0 ? background : index;
}

function wordFitsLine(word: LyricWord, line: LyricLine) {
  validTime(word.beginMs, word.endMs);
  if (line.beginMs !== null && word.beginMs !== null && word.beginMs < line.beginMs || line.endMs !== null && word.endMs !== null && word.endMs > line.endMs) throw new Error('Word time exceeds line');
}

/** Resolve every ID from the current document, then check document-order continuity. */
function consecutive<T extends { id: string }>(siblings: T[], ids: string[]): T[] {
  const selected = siblings.filter(item => ids.includes(item.id));
  if (ids.length < 2 || new Set(ids).size !== ids.length || selected.length !== ids.length) throw new Error('请选择至少两个有效且同属一处的单元');
  const start = siblings.indexOf(selected[0]);
  if (selected.some((item, index) => siblings[start + index] !== item)) throw new Error('只能合并连续选区，不能跳过空白或标点');
  return selected;
}

function timeEnvelope(units: { beginMs: TimeMs; endMs: TimeMs }[]) {
  const starts = units.flatMap(unit => unit.beginMs === null ? [] : [unit.beginMs]);
  const ends = units.flatMap(unit => unit.endMs === null ? [] : [unit.endMs]);
  const beginMs = starts.length ? Math.min(...starts) : null;
  const endMs = ends.length ? Math.max(...ends) : null;
  return { beginMs, endMs };
}

function rubyFitsWord(unit: RubyUnit, word: LyricWord) {
  validTime(unit.beginMs, unit.endMs);
  if (word.beginMs !== null && unit.beginMs !== null && unit.beginMs < word.beginMs || word.endMs !== null && unit.endMs !== null && unit.endMs > word.endMs) throw new Error('正文词时间不能排除注音单元，请先调整时间');
}

export function planWordMerge(document: LyricDocument, ids: string[]) {
  const owners = document.lines.filter(line => line.words.some(word => ids.includes(word.id)));
  if (owners.length !== 1) throw new Error('只能合并同一行的词，主行与背景分别处理');
  const line = owners[0], words = consecutive(line.words, ids);
  const merged = { ...words[0], text: words.map(word => word.text).join(''), ...timeEnvelope(words),
    rubyUnits: words.flatMap(word => word.rubyUnits), obscene: words.some(word => word.obscene) };
  wordFitsLine(merged, line);
  merged.rubyUnits.forEach(unit => rubyFitsWord(unit, merged));
  return { line, words, merged };
}

export function planRubyMerge(document: LyricDocument, ids: string[]) {
  const owners = document.lines.flatMap(line => line.words.filter(word => word.rubyUnits.some(unit => ids.includes(unit.id))).map(word => ({ line, word })));
  if (owners.length !== 1) throw new Error('只能合并同一正文词内的读音');
  const { line, word } = owners[0], units = consecutive(word.rubyUnits, ids);
  const merged = { ...units[0], reading: units.map(unit => unit.reading).join(''), ...timeEnvelope(units) };
  rubyFitsWord(merged, word);
  wordFitsLine({ ...word, ...timeEnvelope([word, merged]) }, line);
  return { line, word, units, merged };
}

export type LineSplitPlan = {
  lineId: string;
  beforeWordIds: string[];
  newLineIds: string[];
  contentTargets: Record<string, number>;
  translationTargets: Record<string, number>;
  backgroundTarget: number | null;
};

/** The dialog and command share exact segment boundaries and validation. */
export function previewLineSplit(line: LyricLine, beforeWordIds: string[]) {
  const cuts = line.words.flatMap((word, index) => beforeWordIds.includes(word.id) ? [index] : []);
  if (!cuts.length || cuts[0] === 0 || cuts.length !== beforeWordIds.length) throw new Error('请选择有效的词间切点');
  const bounds = [0, ...cuts, line.words.length];
  return bounds.slice(0, -1).map((start, index) => {
    const words = line.words.slice(start, bounds[index + 1]);
    const envelope = timeEnvelope(words);
    const segment = { ...line, words, ...envelope,
      endLink: index === cuts.length && envelope.endMs === line.endMs ? line.endLink : null };
    let issue: string | null = null;
    try { validTime(segment.beginMs, segment.endMs); words.forEach(word => wordFitsLine(word, segment)); }
    catch { issue = `第 ${index + 1} 行时间不合法或排除了段内词，请先调整原词时间`; }
    return { segment, issue };
  });
}

function applyStructure(document: LyricDocument, command: AtomicLyricCommand): LyricDocument | null {
  switch (command.type) {
    case 'sync-stamp': return stampSync(document, command.cursor, command.action, command.timeMs, command.mode);
    case 'insert-line': {
      const line = command.line ?? createLine('');
      if (document.lines.some((item) => item.id === line.id)) throw new Error(`Line id already exists: ${line.id}`);
      if (line.backgroundOf) throw new Error('Insert a background vocal with its parent line');
      const after = command.afterLineId === null ? -1 : afterLineGroup(document.lines, command.afterLineId);
      const lines = document.lines.slice();
      lines.splice(after + 1, 0, line);
      return { ...document, lines };
    }
    case 'set-background-of': {
      const sourceIndex = lineIndex(document, command.lineId);
      const source = document.lines[sourceIndex];
      if (source.backgroundOf === command.parentLineId) return document;
      if (command.parentLineId === null) {
        const lines = document.lines.slice();
        lines[sourceIndex] = { ...source, backgroundOf: null };
        return { ...document, lines };
      }
      const parent = document.lines[lineIndex(document, command.parentLineId)];
      if (source.id === parent.id || parent.backgroundOf) throw new Error('背景歌词只能附属于另一条主行');
      if (document.lines.some((line) => line.backgroundOf === source.id)) throw new Error('此行已有背景歌词，请先处理所属关系');
      if (document.lines.some((line) => line.backgroundOf === parent.id && line.id !== source.id)) throw new Error('目标主行已有背景歌词');
      if (source.endLink || document.lines.some((line) => line.endLink?.targetLineId === source.id)) throw new Error('此行有行尾链接，请先处理');
      const lines = document.lines.filter((line) => line.id !== source.id);
      const parentIndex = lines.findIndex((line) => line.id === parent.id);
      lines.splice(parentIndex + 1, 0, { ...source, backgroundOf: parent.id, songPart: null });
      return { ...document, lines };
    }
    case 'delete-line': {
      lineIndex(document, command.lineId);
      const removed = new Set(document.lines.filter((line) => line.id === command.lineId || line.backgroundOf === command.lineId).map((line) => line.id));
      const lines = document.lines.filter((line) => !removed.has(line.id)).map((line) => {
        if (!line.endLink || !removed.has(line.endLink.targetLineId)) return line;
        return { ...line, endLink: null };
      });
      const romanizationTracks = document.romanizationTracks.map((track) => ({ ...track, contents: track.contents.filter((content) => !removed.has(content.lineId)) }));
      const translationTracks = document.translationTracks.map(track => ({ ...track, contents: track.contents.filter(content => !removed.has(content.lineId)) }));
      return { ...document, lines, romanizationTracks, translationTracks };
    }
    case 'move-line': {
      const index = lineIndex(document, command.lineId);
      const line = document.lines[index];
      if (line.backgroundOf) throw new Error('Move the parent line to move its background vocal');
      const group = document.lines.filter((item) => item.id === line.id || item.backgroundOf === line.id);
      const rest = document.lines.filter((item) => !group.includes(item));
      if (command.afterLineId !== null && group.some((item) => item.id === command.afterLineId)) throw new Error('Cannot move a line after itself');
      const after = command.afterLineId === null ? -1 : afterLineGroup(rest, command.afterLineId);
      rest.splice(after + 1, 0, ...group);
      return rest.every((item, i) => item === document.lines[i]) ? document : { ...document, lines: rest };
    }
    case 'split-line': {
      const index = lineIndex(document, command.lineId), line = document.lines[index];
      const issues = lineStructureIssues(document, line);
      if (issues.length) throw new Error(issues.join('；'));
      const preview = previewLineSplit(line, command.beforeWordIds);
      const invalid = preview.flatMap(item => item.issue ? [item.issue] : []);
      if (invalid.length) throw new Error(invalid.join('；'));
      if (command.newLineIds.length !== preview.length - 1 || new Set(command.newLineIds).size !== command.newLineIds.length || command.newLineIds.some(id => document.lines.some(item => item.id === id))) throw new Error('新行 ID 无效');
      const segments = preview.map(({ segment }, i) => ({ ...segment, id: i ? command.newLineIds[i - 1] : line.id }));
      const assigned = (targets: Record<string, number>, contents: { id: string; lineId: string }[], label: string) => {
        const attached = contents.filter(content => content.lineId === line.id);
        if (Object.keys(targets).some(id => !attached.some(content => content.id === id))) throw new Error(`${label}分配条目不存在`);
        if (attached.some(content => !Number.isInteger(targets[content.id]) || !segments[targets[content.id]])) throw new Error(`${label}归属已失效，请重新选择`);
      };
      assigned(command.contentTargets, document.romanizationTracks.flatMap(track => track.contents), '音译');
      assigned(command.translationTargets, document.translationTracks.flatMap(track => track.contents), '翻译');
      const background = document.lines.find(item => item.backgroundOf === line.id);
      if (background && (command.backgroundTarget === null || !Number.isInteger(command.backgroundTarget) || !segments[command.backgroundTarget])) throw new Error('请重新指定背景歌词归属');
      // Changing the first start detaches incoming links, freezing their existing ends.
      const lines = document.lines.filter(item => item !== background).map(item =>
        item.endLink?.targetLineId === line.id && segments[0].beginMs !== line.beginMs ? { ...item, endLink: null } : item);
      lines.splice(index, 1, ...segments.flatMap((segment, i) => background && i === command.backgroundTarget ? [segment, { ...background, backgroundOf: segment.id }] : [segment]));
      const romanizationTracks = document.romanizationTracks.map(track => ({ ...track, contents: track.contents.map(content => content.lineId === line.id ? { ...content, lineId: segments[command.contentTargets[content.id]].id } : content) }));
      const translationTracks = document.translationTracks.map(track => ({ ...track, contents: track.contents.map(content => content.lineId === line.id ? { ...content, lineId: segments[command.translationTargets[content.id]].id } : content) }));
      return { ...document, lines, romanizationTracks, translationTracks };
    }
    case 'merge-lines': {
      const firstIndex = lineIndex(document, command.firstLineId);
      const secondIndex = lineIndex(document, command.secondLineId);
      const first = document.lines[firstIndex], second = document.lines[secondIndex];
      const issues = lineStructureIssues(document, first, second);
      if (issues.length) throw new Error(issues.join('；'));
      const merged: LyricLine = { ...first, words: [...first.words, ...second.words], beginMs: first.beginMs ?? second.beginMs, endMs: second.endMs ?? first.endMs, endLink: second.endLink && ![first.id, second.id].includes(second.endLink.targetLineId) ? second.endLink : null };
      validTime(merged.beginMs, merged.endMs);
      merged.words.forEach((word) => wordFitsLine(word, merged));
      const lines = document.lines.filter((line) => line.id !== second.id).map((line) => line.id === first.id ? merged : line.endLink?.targetLineId === second.id ? { ...line, endLink: { ...line.endLink, targetLineId: first.id } } : line);
      const romanizationTracks = document.romanizationTracks.map((track) => {
        const secondContents = track.contents.filter((content) => content.lineId === second.id).map((content) => ({ ...content, lineId: first.id }));
        const contents = track.contents.filter((content) => content.lineId !== second.id);
        let lastFirst = -1;
        contents.forEach((content, index) => { if (content.lineId === first.id) lastFirst = index; });
        const originalSecond = track.contents.findIndex((content) => content.lineId === second.id);
        const insertion = lastFirst >= 0 ? lastFirst + 1 : track.contents.slice(0, originalSecond).filter((content) => content.lineId !== second.id).length;
        contents.splice(insertion, 0, ...secondContents);
        return { ...track, contents };
      });
      return { ...document, lines, romanizationTracks };
    }
    case 'insert-word': {
      const index = lineIndex(document, command.lineId);
      const line = document.lines[index];
      if (document.lines.some((item) => item.words.some((word) => word.id === command.word.id))) throw new Error(`Word id already exists: ${command.word.id}`);
      if (!command.word.text) throw new Error('Word text must be non-empty');
      wordFitsLine(command.word, line);
      const after = command.afterWordId === null ? -1 : line.words.findIndex((word) => word.id === command.afterWordId);
      if (command.afterWordId !== null && after < 0) throw new Error(`Word not found: ${command.afterWordId}`);
      const words = line.words.slice();
      words.splice(after + 1, 0, command.word);
      const lines = document.lines.slice();
      lines[index] = { ...line, words };
      return { ...document, lines };
    }
    case 'delete-word': {
      const index = lineIndex(document, command.lineId);
      const line = document.lines[index];
      if (!line.words.some((word) => word.id === command.wordId)) throw new Error(`Word not found: ${command.wordId}`);
      const lines = document.lines.slice();
      lines[index] = { ...line, words: line.words.filter((word) => word.id !== command.wordId) };
      return { ...document, lines };
    }
    case 'segment-word':
      return editWord(document, command.lineId, command.wordId, (word, line) => {
        if (command.words.length < 2 || command.words.map((part) => part.text).join('') !== word.text || command.words[0].id !== word.id) throw new Error('分词必须保留原文和首词 ID');
        if (word.rubyUnits.length || word.obscene || word.emptyBeat) throw new Error('带附属属性的词不能自动分词');
        const ids = command.words.map((part) => part.id);
        if (new Set(ids).size !== ids.length || ids.slice(1).some((id) => document.lines.some((item) => item.words.some((part) => part.id === id)))) throw new Error('分词 ID 重复');
        for (const part of command.words) {
          if (!part.text || part.rubyUnits.length || part.obscene || part.emptyBeat) throw new Error('分词不能引入附属属性');
          wordFitsLine(part, line);
        }
        if (command.words[0].beginMs !== word.beginMs || command.words.at(-1)?.endMs !== word.endMs) throw new Error('分词必须保留父词时间区间');
        return command.words;
      });
    case 'segment-words': {
      if (!command.changes.length) return document;
      const changes = new Map(command.changes.map((change) => [change.wordId, change]));
      if (changes.size !== command.changes.length) throw new Error('分词目标重复');
      const originalIds = new Set(document.lines.flatMap((line) => line.words.map((word) => word.id)));
      const generatedIds = new Set<string>();
      let applied = 0;
      const lines = document.lines.map((line) => {
        if (!line.words.some((word) => changes.has(word.id))) return line;
        const words = line.words.flatMap((word) => {
          const change = changes.get(word.id);
          if (!change) return [word];
          if (change.lineId !== line.id || change.words.length < 2 || change.words[0].id !== word.id || change.words.map((part) => part.text).join('') !== word.text) throw new Error('分词目标或原文不匹配');
          if (word.rubyUnits.length || word.obscene || word.emptyBeat) throw new Error('带附属属性的词不能自动分词');
          if (change.words[0].beginMs !== word.beginMs || change.words.at(-1)?.endMs !== word.endMs) throw new Error('分词必须保留父词时间区间');
          for (const [index, part] of change.words.entries()) {
            if (!part.text || part.rubyUnits.length || part.obscene || part.emptyBeat) throw new Error('分词不能引入附属属性');
            if (generatedIds.has(part.id) || index > 0 && originalIds.has(part.id)) throw new Error('分词 ID 重复');
            generatedIds.add(part.id);
            wordFitsLine(part, line);
          }
          applied++;
          return change.words;
        });
        return { ...line, words };
      });
      if (applied !== changes.size) throw new Error('分词目标不存在');
      return { ...document, lines };
    }
    case 'merge-words': {
      const { line, words: selected, merged } = planWordMerge(document, command.wordIds);
      const ids = new Set(command.wordIds);
      const words = line.words.flatMap(word => word.id === selected[0].id ? [merged] : ids.has(word.id) ? [] : [word]);
      return { ...document, lines: document.lines.map(item => item === line ? { ...line, words } : item) };
    }
    case 'merge-ruby': {
      const { line, word, units, merged } = planRubyMerge(document, command.rubyIds);
      const ids = new Set(command.rubyIds);
      return editWord(document, line.id, word.id, () => [{ ...word, rubyUnits: word.rubyUnits.flatMap(unit => unit.id === units[0].id ? [merged] : ids.has(unit.id) ? [] : [unit]) }]);
    }
    case 'move-word': {
      const fromIndex = lineIndex(document, command.lineId);
      const toIndex = lineIndex(document, command.toLineId);
      const from = document.lines[fromIndex];
      const to = document.lines[toIndex];
      const word = from.words.find((item) => item.id === command.wordId);
      if (!word) throw new Error(`Word not found: ${command.wordId}`);
      if (command.afterWordId === word.id) throw new Error('Cannot move a word after itself');
      wordFitsLine(word, to);
      const destination = to.words.filter((item) => item.id !== word.id);
      const after = command.afterWordId === null ? -1 : destination.findIndex((item) => item.id === command.afterWordId);
      if (command.afterWordId !== null && after < 0) throw new Error(`Word not found: ${command.afterWordId}`);
      destination.splice(after + 1, 0, word);
      const lines = document.lines.slice();
      if (fromIndex === toIndex) {
        if (destination.every((item, index) => item === from.words[index])) return document;
        lines[fromIndex] = { ...from, words: destination };
      } else {
        lines[fromIndex] = { ...from, words: from.words.filter((item) => item.id !== word.id) };
        lines[toIndex] = { ...to, words: destination };
      }
      return { ...document, lines };
    }
    case 'set-line-time': {
      validTime(command.beginMs, command.endMs);
      const index = lineIndex(document, command.lineId);
      const line = document.lines[index];
      if (line.words.some((word) => command.beginMs !== null && word.beginMs !== null && word.beginMs < command.beginMs || command.endMs !== null && word.endMs !== null && word.endMs > command.endMs)) throw new Error('Line time cannot exclude a word');
      if (line.beginMs === command.beginMs && line.endMs === command.endMs) return document;
      const lines = document.lines.slice();
      lines[index] = { ...line, beginMs: command.beginMs, endMs: command.endMs, endLink: line.endMs === command.endMs ? line.endLink : null };
      for (let linkedIndex = 0; linkedIndex < lines.length; linkedIndex++) {
        const linked = lines[linkedIndex];
        if (linked.endLink?.targetLineId !== line.id) continue;
        const linkedEnd = command.beginMs;
        if (linkedEnd === null || linked.words.some((word) => word.endMs !== null && word.endMs > linkedEnd)) throw new Error('Linked line end cannot precede its words');
        validTime(linked.beginMs, linkedEnd);
        lines[linkedIndex] = { ...linked, endMs: linkedEnd };
      }
      return { ...document, lines };
    }
    case 'link-line-end': {
      const index = lineIndex(document, command.lineId);
      const target = document.lines[lineIndex(document, command.targetLineId)];
      const line = document.lines[index];
      if (line.id === target.id || line.backgroundOf || target.backgroundOf || target.beginMs === null) throw new Error('只能链接到其他已定开始时间的主唱行');
      const targetBegin = target.beginMs;
      if (line.words.some((word) => word.endMs !== null && word.endMs > targetBegin)) throw new Error('目标行开始时间早于当前词结束时间');
      validTime(line.beginMs, targetBegin);
      if (line.endLink?.targetLineId === target.id) return document;
      const lines = document.lines.slice();
      lines[index] = { ...line, endMs: targetBegin, endLink: { targetLineId: target.id } };
      return { ...document, lines };
    }
    case 'unlink-line-end': {
      const index = lineIndex(document, command.lineId);
      const line = document.lines[index];
      if (!line.endLink) return document;
      const lines = document.lines.slice();
      lines[index] = { ...line, endLink: null };
      return { ...document, lines };
    }
    case 'set-line-agents': {
      const index = lineIndex(document, command.lineId);
      const line = document.lines[index];
      if (command.agentRefs.some((ref) => !document.agents.some((agent) => agent.id === ref))) throw new Error('Unknown lyric agent');
      const lines = document.lines.slice();
      lines[index] = { ...line, agentRefs: command.agentRefs };
      return { ...document, lines };
    }
    case 'set-ignore-sync': {
      const index = lineIndex(document, command.lineId);
      const line = document.lines[index];
      if (line.backgroundOf) throw new Error('背景行不参与打轴');
      if (line.ignoreSync === command.ignoreSync) return document;
      const lines = document.lines.slice();
      lines[index] = { ...line, ignoreSync: command.ignoreSync };
      return { ...document, lines };
    }
    case 'set-translation-tracks': {
      if (command.source !== document.translationTracks) throw new Error('翻译已变化，请重新执行操作');
      validateTranslationTracks(command.tracks, new Set(document.lines.map(line => line.id)));
      return JSON.stringify(command.tracks) === JSON.stringify(document.translationTracks) ? document : { ...document, translationTracks: command.tracks };
    }
    case 'insert-translation-content': {
      if (!document.translationTracks.some(track => track.id === command.trackId)) throw new Error('翻译轨道不存在');
      const translationTracks = document.translationTracks.map(track => track.id !== command.trackId ? track : { ...track, contents: [...track.contents, command.content] });
      validateTranslationTracks(translationTracks, new Set(document.lines.map(line => line.id)));
      return { ...document, translationTracks };
    }
    case 'add-romanization-track':
      if (document.romanizationTracks.some((track) => track.id === command.track.id)) throw new Error('音译轨道 ID 重复');
      if (command.track.contents.length) throw new Error('新轨道必须为空');
      return { ...document, romanizationTracks: [...document.romanizationTracks, command.track] };
    case 'delete-romanization-track':
      if (!document.romanizationTracks.some((track) => track.id === command.trackId)) throw new Error('音译轨道不存在');
      return { ...document, romanizationTracks: document.romanizationTracks.filter((track) => track.id !== command.trackId) };
    case 'set-romanization-track-language': {
      if (command.language !== null && !/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(command.language)) throw new Error('音译语言标签无效');
      const index = document.romanizationTracks.findIndex((track) => track.id === command.trackId);
      if (index < 0) throw new Error('音译轨道不存在');
      const romanizationTracks = document.romanizationTracks.slice();
      romanizationTracks[index] = { ...romanizationTracks[index], language: command.language };
      return { ...document, romanizationTracks };
    }
    case 'move-romanization-track': {
      const index = document.romanizationTracks.findIndex((track) => track.id === command.trackId);
      if (index < 0) throw new Error('音译轨道不存在');
      const target = index + command.direction;
      if (target < 0 || target >= document.romanizationTracks.length) return document;
      const romanizationTracks = document.romanizationTracks.slice();
      [romanizationTracks[index], romanizationTracks[target]] = [romanizationTracks[target], romanizationTracks[index]];
      return { ...document, romanizationTracks };
    }
    case 'insert-romanization-content':
    case 'set-romanization-content':
    case 'delete-romanization-content': {
      const index = document.romanizationTracks.findIndex((track) => track.id === command.trackId);
      if (index < 0) throw new Error('音译轨道不存在');
      const track = document.romanizationTracks[index];
      const contentIndex = track.contents.findIndex((content) => content.id === (command.type === 'delete-romanization-content' ? command.contentId : command.content.id));
      let contents: RomanizationContent[];
      if (command.type === 'insert-romanization-content') {
        if (document.romanizationTracks.some((item) => item.contents.some((content) => content.id === command.content.id))) throw new Error('音译内容 ID 重复');
        if (!document.lines.some((line) => line.id === command.content.lineId)) throw new Error('音译所属行不存在');
        if (command.content.kind === 'timed') {
          if (new Set(command.content.units.map((unit) => unit.id)).size !== command.content.units.length) throw new Error('音译单元 ID 重复');
          command.content.units.forEach((unit) => validTime(unit.beginMs, unit.endMs));
        }
        contents = [...track.contents, command.content];
      } else {
        if (contentIndex < 0) throw new Error('音译内容不存在');
        if (command.type === 'set-romanization-content') {
          if (!document.lines.some((line) => line.id === command.content.lineId)) throw new Error('音译所属行不存在');
          if (command.content.kind === 'timed') {
            if (new Set(command.content.units.map((unit) => unit.id)).size !== command.content.units.length) throw new Error('音译单元 ID 重复');
            command.content.units.forEach((unit) => validTime(unit.beginMs, unit.endMs));
          }
          contents = track.contents.slice(); contents[contentIndex] = command.content;
        } else contents = track.contents.filter((content) => content.id !== command.contentId);
      }
      const romanizationTracks = document.romanizationTracks.slice();
      romanizationTracks[index] = { ...track, contents };
      return { ...document, romanizationTracks };
    }
    case 'move-romanization-content': {
      const index = document.romanizationTracks.findIndex((track) => track.id === command.trackId);
      if (index < 0) throw new Error('音译轨道不存在');
      if (!document.lines.some((line) => line.id === command.lineId)) throw new Error('音译所属行不存在');
      const track = document.romanizationTracks[index];
      const content = track.contents.find((item) => item.id === command.contentId);
      if (!content) throw new Error('音译内容不存在');
      const contents = track.contents.filter((item) => item.id !== command.contentId);
      const after = command.afterContentId === null ? -1 : contents.findIndex((item) => item.id === command.afterContentId);
      if (command.afterContentId !== null && after < 0) throw new Error('音译位置不存在');
      contents.splice(after + 1, 0, { ...content, lineId: command.lineId });
      const romanizationTracks = document.romanizationTracks.slice();
      romanizationTracks[index] = { ...track, contents };
      return { ...document, romanizationTracks };
    }
    case 'split-romanization-unit':
    case 'merge-romanization-units':
    case 'move-romanization-unit': {
      const index = document.romanizationTracks.findIndex((track) => track.id === command.trackId);
      if (index < 0) throw new Error('音译轨道不存在');
      const track = document.romanizationTracks[index];
      const contentIndex = track.contents.findIndex((content) => content.id === command.contentId);
      const content = track.contents[contentIndex];
      if (!content || content.kind !== 'timed') throw new Error('请选择定时音译内容');
      const units = content.units.slice();
      if (command.type === 'split-romanization-unit') {
        const unitIndex = units.findIndex((unit) => unit.id === command.unitId);
        if (unitIndex < 0) throw new Error('音译单元不存在');
        const unit = units[unitIndex];
        const [left, right] = splitAtGrapheme(unit.text, command.at);
        const middle = splitTime(unit.beginMs, unit.endMs, Array.from(left).length, Array.from(unit.text).length);
        units.splice(unitIndex, 1, { ...unit, text: left, endMs: middle }, { id: crypto.randomUUID(), text: right, beginMs: middle, endMs: unit.endMs });
      } else if (command.type === 'merge-romanization-units') {
        const first = units.findIndex((unit) => unit.id === command.firstUnitId);
        if (first < 0 || units[first + 1]?.id !== command.secondUnitId) throw new Error('只能合并相邻音译单元');
        const left = units[first], right = units[first + 1];
        units.splice(first, 2, { ...left, text: left.text + right.text,
          beginMs: left.beginMs === null ? right.beginMs : right.beginMs === null ? left.beginMs : Math.min(left.beginMs, right.beginMs),
          endMs: left.endMs === null ? right.endMs : right.endMs === null ? left.endMs : Math.max(left.endMs, right.endMs) });
      } else {
        const unitIndex = units.findIndex((unit) => unit.id === command.unitId);
        if (unitIndex < 0) throw new Error('音译单元不存在');
        const [unit] = units.splice(unitIndex, 1);
        const after = command.afterUnitId === null ? -1 : units.findIndex((item) => item.id === command.afterUnitId);
        if (command.afterUnitId !== null && after < 0) throw new Error('音译位置不存在');
        units.splice(after + 1, 0, unit);
      }
      const contents = track.contents.slice();
      contents[contentIndex] = { ...content, units };
      const romanizationTracks = document.romanizationTracks.slice();
      romanizationTracks[index] = { ...track, contents };
      return { ...document, romanizationTracks };
    }
    case 'set-metadata': {
      if (!/^[A-Za-z][\w.-]*$/.test(command.key)) throw new Error(`Invalid metadata name: ${command.key}`);
      const metadata = { ...document.metadata };
      if (command.values.length) metadata[command.key] = command.values;
      else delete metadata[command.key];
      return { ...document, metadata };
    }
    case 'set-language':
      if (command.language !== null && !/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(command.language)) throw new Error('Invalid language tag');
      return { ...document, language: command.language };
    case 'rename-metadata': {
      if (!Object.hasOwn(document.metadata, command.key)) throw new Error('元数据键不存在');
      if (command.key === command.nextKey) return document;
      if (!/^[A-Za-z][\w.-]*$/.test(command.nextKey) || Object.hasOwn(document.metadata, command.nextKey)) throw new Error('元数据键非法或已存在');
      return { ...document, metadata: Object.fromEntries(Object.entries(document.metadata).map(([key, values]) => [key === command.key ? command.nextKey : key, values])) };
    }
    case 'rename-agent': {
      if (!document.agents.some(a => a.id === command.id)) throw new Error('歌手不存在');
      if (command.id === command.nextId) return document;
      if (!/^[A-Za-z_][\w.-]*$/.test(command.nextId) || document.agents.some(a => a.id === command.nextId)) throw new Error('歌手 ID 非法或已存在');
      return { ...document, agents: document.agents.map(a => ({ ...a, id: a.id === command.id ? command.nextId : a.id, ...(a.actorRef === command.id ? { actorRef: command.nextId } : {}) })), lines: document.lines.map(l => ({ ...l, agentRefs: l.agentRefs.map(id => id === command.id ? command.nextId : id) })) };
    }
    case 'delete-agent': {
      if (!document.agents.some(a => a.id === command.id)) throw new Error('歌手不存在');
      return { ...document, agents: document.agents.filter(a => a.id !== command.id).map(a => { if (a.actorRef !== command.id) return a; const { actorRef: _, ...rest } = a; return rest; }), lines: document.lines.map(l => ({ ...l, agentRefs: l.agentRefs.filter(id => id !== command.id) })) };
    }
    case 'set-agents':
      if (command.agents.some(a => a.actorRef !== undefined && !command.agents.some(target => target.id === a.actorRef))) throw new Error('未知 actor 引用');
      if (command.agents.some((agent) => !/^[A-Za-z_][\w.-]*$/.test(agent.id)) || new Set(command.agents.map((agent) => agent.id)).size !== command.agents.length) throw new Error('Invalid or duplicate agent ID');
      if (document.lines.some((line) => line.agentRefs.some((ref) => !command.agents.some((agent) => agent.id === ref)))) throw new Error('An assigned agent cannot be removed');
      return { ...document, agents: command.agents };
    case 'move-ruby': {
      const line = document.lines.find(line => line.id === command.lineId);
      const source = line?.words.find(word => word.id === command.wordId);
      const target = line?.words.find(word => word.id === (command.toWordId ?? command.wordId));
      if (!line || !source || !target) throw new Error('读音只能移到同一歌词行中的正文词');
      const ids = new Set(command.rubyIds ?? [command.rubyId]);
      const units = source.rubyUnits.filter(unit => ids.has(unit.id));
      if (!ids.has(command.rubyId) || !units.length || units.length !== ids.size) throw new Error('读音单元不存在');
      if (source === target && command.afterRubyId !== null && ids.has(command.afterRubyId)) return document;
      const remaining = target.rubyUnits.filter(unit => source !== target || !ids.has(unit.id));
      const after = command.afterRubyId === null ? -1 : remaining.findIndex(unit => unit.id === command.afterRubyId);
      if (command.afterRubyId !== null && after < 0) throw new Error('读音目标位置不存在');
      remaining.splice(after + 1, 0, ...units);
      if (source === target && remaining.every((unit, index) => unit === source.rubyUnits[index])) return document;
      const words = line.words.map(word => word === target ? { ...word, rubyUnits: remaining }
        : word === source ? { ...word, rubyUnits: word.rubyUnits.filter(unit => !ids.has(unit.id)) } : word);
      return { ...document, lines: document.lines.map(item => item === line ? { ...line, words } : item) };
    }
    case 'replace-document':
      return command.document;
    default:
      return null;
  }
}

function applyAtomic(document: LyricDocument, command: AtomicLyricCommand): LyricDocument {
  const structured = applyStructure(document, command);
  const wordCommand = command as WordCommand;
  return structured ?? editWord(document, wordCommand.lineId, wordCommand.wordId, (word, line) => {
    switch (wordCommand.type) {
      case 'split-word': {
        if (word.rubyUnits.length) throw new Error('拆分带注音的正文前，请先明确拆分读音');
        if (word.obscene || word.emptyBeat) throw new Error('Splitting a word with attached properties requires explicit redistribution');
        const [left, right] = splitAtGrapheme(word.text, wordCommand.at);
        const newId = wordCommand.newWordId ?? crypto.randomUUID();
        if (line.words.some((item) => item.id === newId)) throw new Error('Word id already exists');
        const middle = splitTime(word.beginMs, word.endMs, Array.from(left).length, Array.from(word.text).length);
        return [
          { ...word, text: left, endMs: middle },
          { ...createWord(right, newId), beginMs: middle, endMs: word.endMs },
        ];
      }
      case 'edit-word':
        if (!wordCommand.text) throw new Error('Word text must be non-empty');
        return [wordCommand.text === word.text ? word : { ...word, text: wordCommand.text }];
      case 'set-word-time':
        validTime(wordCommand.beginMs, wordCommand.endMs);
        if (line.beginMs !== null && wordCommand.beginMs !== null && wordCommand.beginMs < line.beginMs) throw new Error('Word starts before line');
        if (line.endMs !== null && wordCommand.endMs !== null && wordCommand.endMs > line.endMs) throw new Error('Word ends after line');
        if (word.rubyUnits.some((unit) => wordCommand.beginMs !== null && unit.beginMs !== null && unit.beginMs < wordCommand.beginMs || wordCommand.endMs !== null && unit.endMs !== null && unit.endMs > wordCommand.endMs)) throw new Error('正文词时间不能排除注音单元');
        return [word.beginMs === wordCommand.beginMs && word.endMs === wordCommand.endMs ? word : { ...word, beginMs: wordCommand.beginMs, endMs: wordCommand.endMs }];
      case 'add-ruby': {
        if (!wordCommand.reading) throw new Error('注音读音不能为空');
        const id = wordCommand.rubyId ?? crypto.randomUUID();
        if (word.rubyUnits.some((unit) => unit.id === id)) throw new Error('注音单元标识重复');
        return [{ ...word, rubyUnits: [...word.rubyUnits, { id, reading: wordCommand.reading, beginMs: null, endMs: null }] }];
      }
      case 'insert-ruby': {
        if (!wordCommand.reading) throw new Error('注音读音不能为空');
        const id = wordCommand.rubyId ?? crypto.randomUUID();
        if (word.rubyUnits.some((unit) => unit.id === id)) throw new Error('注音单元标识重复');
        const after = wordCommand.afterRubyId === null ? -1 : word.rubyUnits.findIndex((unit) => unit.id === wordCommand.afterRubyId);
        if (wordCommand.afterRubyId !== null && after < 0) throw new Error('注音插入位置已不存在');
        const rubyUnits = word.rubyUnits.slice();
        rubyUnits.splice(after + 1, 0, { id, reading: wordCommand.reading, beginMs: null, endMs: null });
        return [{ ...word, rubyUnits }];
      }
      case 'set-ruby-units': {
        if (word.rubyUnits.length && !wordCommand.overwrite) throw new Error('已有手动 注音，需明确选择覆盖');
        if (!wordCommand.units.length || wordCommand.units.some((unit) => !unit.reading)) throw new Error('注音读音不能为空');
        if (new Set(wordCommand.units.map((unit) => unit.id)).size !== wordCommand.units.length) throw new Error('注音单元标识重复');
        for (const unit of wordCommand.units) {
          validTime(unit.beginMs, unit.endMs);
          if (word.beginMs !== null && unit.beginMs !== null && unit.beginMs < word.beginMs || word.endMs !== null && unit.endMs !== null && unit.endMs > word.endMs) throw new Error('注音单元时间超出正文词');
        }
        return [{ ...word, rubyUnits: wordCommand.units }];
      }
      case 'redistribute-ruby-time':
        return [{ ...word, rubyUnits: distributeRubyTime(word, word.rubyUnits) }];
      case 'set-word-empty-beat':
        if (!Number.isSafeInteger(wordCommand.emptyBeat) || wordCommand.emptyBeat < 0 || wordCommand.emptyBeat > 32) throw new Error('空拍数必须是 0–32 的整数');
        return [word.emptyBeat === wordCommand.emptyBeat ? word : { ...word, emptyBeat: wordCommand.emptyBeat }];
      case 'split-ruby':
        return [updateRuby(word, wordCommand.rubyId, (unit) => {
            const [left, right] = splitAtGrapheme(unit.reading, wordCommand.at);
          const id = wordCommand.newRubyId ?? crypto.randomUUID();
          if (word.rubyUnits.some((item) => item.id === id)) throw new Error('注音单元标识重复');
          const middle = splitTime(unit.beginMs, unit.endMs, splitReadingMora(left).length, splitReadingMora(unit.reading).length);
          return [{ ...unit, reading: left, endMs: middle }, { id, reading: right, beginMs: middle, endMs: unit.endMs }];
        })];
      case 'edit-ruby': {
        if (!wordCommand.reading) throw new Error('注音读音不能为空');
        const updated = updateRuby(word, wordCommand.rubyId, (unit) => wordCommand.reading === unit.reading ? [unit] : [{ ...unit, reading: wordCommand.reading }]);
        return [updated];
      }
      case 'delete-ruby':
        return [{ ...updateRuby(word, wordCommand.rubyId, () => []) }];
      case 'set-ruby-time': {
        validTime(wordCommand.beginMs, wordCommand.endMs);
        if (word.beginMs !== null && wordCommand.beginMs !== null && wordCommand.beginMs < word.beginMs || word.endMs !== null && wordCommand.endMs !== null && wordCommand.endMs > word.endMs) throw new Error('注音单元时间超出正文词');
        const updated = updateRuby(word, wordCommand.rubyId, (unit) => unit.beginMs === wordCommand.beginMs && unit.endMs === wordCommand.endMs ? [unit] : [{ ...unit, beginMs: wordCommand.beginMs, endMs: wordCommand.endMs }]);
        if (updated === word) return [word];
        const beginMs = word.beginMs ?? (updated.rubyUnits.every((unit) => unit.beginMs !== null) ? Math.min(...updated.rubyUnits.map((unit) => unit.beginMs!)) : null);
        const endMs = word.endMs ?? (updated.rubyUnits.every((unit) => unit.endMs !== null) ? Math.max(...updated.rubyUnits.map((unit) => unit.endMs!)) : null);
        return [{ ...updated, beginMs, endMs }];
      }
    }
  });
}

export function executeLyricCommand(state: LyricEditorState, command: LyricCommand): LyricEditorState {
  const next = applyLyricCommand(state.present, command);
  if (next === state.present) return state;
  return { present: next, past: [...state.past.slice(-(MAX_HISTORY - 1)), state.present], future: [] };
}

export function undoLyricCommand(state: LyricEditorState): LyricEditorState {
  if (!state.past.length) return state;
  return { present: state.past.at(-1)!, past: state.past.slice(0, -1), future: [state.present, ...state.future] };
}

export function redoLyricCommand(state: LyricEditorState): LyricEditorState {
  if (!state.future.length) return state;
  return { present: state.future[0], past: [...state.past, state.present], future: state.future.slice(1) };
}

export function applyLyricCommand(document: LyricDocument, command: LyricCommand): LyricDocument {
  return command.type === 'batch' ? command.commands.reduce(applyAtomic, document) : applyAtomic(document, command);
}
