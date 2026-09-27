import { createLine, createWord, type AlignmentUnit, type LyricAgent, type LyricDocument, type LyricLine, type LyricWord, type RomanizationContent, type RomanizationTrack, type RubyUnit, type SubLyric, type TimeUs } from './lyric-document';
import { splitAtGrapheme } from './text-boundaries';
import { distributeRubyTime, splitReadingMora } from './ruby-editing';
import { stampSync, type SyncAction, type SyncCursor } from './sync-editing';

const MAX_HISTORY = 256;

type AtomicLyricCommand =
  | { type: 'insert-line'; afterLineId: string | null; line?: LyricLine }
  | { type: 'set-background-of'; lineId: string; parentLineId: string | null }
  | { type: 'delete-line'; lineId: string }
  | { type: 'move-line'; lineId: string; afterLineId: string | null }
  | { type: 'insert-word'; lineId: string; afterWordId: string | null; word: LyricWord }
  | { type: 'delete-word'; lineId: string; wordId: string }
  | { type: 'set-word-alignments'; lineId: string; wordId: string; units: AlignmentUnit[] }
  | { type: 'segment-word'; lineId: string; wordId: string; words: LyricWord[] }
  | { type: 'segment-words'; changes: Array<{ lineId: string; wordId: string; words: LyricWord[] }> }
  | { type: 'merge-words'; lineId: string; firstWordId: string; secondWordId: string }
  | { type: 'merge-ruby-base'; lineId: string; wordIds: string[] }
  | { type: 'move-word'; lineId: string; wordId: string; toLineId: string; afterWordId: string | null }
  | { type: 'set-line-time'; lineId: string; beginUs: TimeUs; endUs: TimeUs }
  | { type: 'link-line-end'; lineId: string; targetLineId: string }
  | { type: 'unlink-line-end'; lineId: string }
  | { type: 'set-line-agents'; lineId: string; agentRefs: string[] }
  | { type: 'set-ignore-sync'; lineId: string; ignoreSync: boolean }
  | { type: 'set-sublyrics'; lineId: string; kind: 'translations'; items: SubLyric[] }
  | { type: 'add-romanization-track'; track: RomanizationTrack }
  | { type: 'delete-romanization-track'; trackId: string }
  | { type: 'move-romanization-track'; trackId: string; direction: -1 | 1 }
  | { type: 'insert-romanization-content'; trackId: string; content: RomanizationContent }
  | { type: 'set-romanization-content'; trackId: string; content: RomanizationContent }
  | { type: 'delete-romanization-content'; trackId: string; contentId: string }
  | { type: 'set-metadata'; key: string; values: string[] }
  | { type: 'set-language'; language: string | null }
  | { type: 'set-agents'; agents: LyricAgent[] }
  | { type: 'sync-stamp'; cursor: SyncCursor; action: SyncAction; timeUs: number }
  | { type: 'replace-document'; document: LyricDocument }
  | { type: 'split-word'; lineId: string; wordId: string; at: number; newWordId?: string }
  | { type: 'edit-word'; lineId: string; wordId: string; text: string }
  | { type: 'set-word-time'; lineId: string; wordId: string; beginUs: TimeUs; endUs: TimeUs }
  | { type: 'add-ruby'; lineId: string; wordId: string; reading: string; rubyId?: string }
  | { type: 'insert-ruby'; lineId: string; wordId: string; afterRubyId: string | null; reading: string; rubyId?: string }
  | { type: 'merge-ruby'; lineId: string; wordId: string; firstRubyId: string; secondRubyId: string }
  | { type: 'set-ruby-units'; lineId: string; wordId: string; units: RubyUnit[]; overwrite?: boolean }
  | { type: 'redistribute-ruby-time'; lineId: string; wordId: string }
  | { type: 'set-word-empty-beat'; lineId: string; wordId: string; emptyBeat: number }
  | { type: 'split-ruby'; lineId: string; wordId: string; rubyId: string; at: number; newRubyId?: string }
  | { type: 'edit-ruby'; lineId: string; wordId: string; rubyId: string; reading: string }
  | { type: 'delete-ruby'; lineId: string; wordId: string; rubyId: string }
  | { type: 'set-ruby-time'; lineId: string; wordId: string; rubyId: string; beginUs: TimeUs; endUs: TimeUs };

export type LyricCommand = AtomicLyricCommand | { type: 'batch'; commands: AtomicLyricCommand[] };
type WordCommand = Extract<AtomicLyricCommand, { type: 'split-word' | 'edit-word' | 'set-word-time' | 'add-ruby' | 'insert-ruby' | 'merge-ruby' | 'set-ruby-units' | 'redistribute-ruby-time' | 'set-word-empty-beat' | 'split-ruby' | 'edit-ruby' | 'delete-ruby' | 'set-ruby-time' }>;

export type LyricEditorState = { present: LyricDocument; past: LyricDocument[]; future: LyricDocument[] };

export function createLyricEditorState(document: LyricDocument): LyricEditorState {
  return { present: document, past: [], future: [] };
}

function validTime(beginUs: TimeUs, endUs: TimeUs) {
  for (const value of [beginUs, endUs]) if (value !== null && (!Number.isSafeInteger(value) || value < 0)) throw new Error('Time must be a non-negative integer or null');
  if (beginUs !== null && endUs !== null && beginUs > endUs) throw new Error('Begin time exceeds end time');
}

function splitTime(beginUs: TimeUs, endUs: TimeUs, leftLength: number, totalLength: number): TimeUs {
  if (beginUs === null || endUs === null) return null;
  return beginUs + Math.round((endUs - beginUs) * leftLength / totalLength);
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
  if (index < 0) throw new Error(`Ruby unit not found: ${rubyId}`);
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
  validTime(word.beginUs, word.endUs);
  if (line.beginUs !== null && word.beginUs !== null && word.beginUs < line.beginUs || line.endUs !== null && word.endUs !== null && word.endUs > line.endUs) throw new Error('Word time exceeds line');
}

function applyStructure(document: LyricDocument, command: AtomicLyricCommand): LyricDocument | null {
  switch (command.type) {
    case 'sync-stamp': return stampSync(document, command.cursor, command.action, command.timeUs);
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
      if (document.romanizationTracks.some((track) => track.contents.some((content) => content.lineId === source.id))) throw new Error('此行有音译内容，请先转移或删除');
      if (source.translations.length || source.endLink || document.lines.some((line) => line.endLink?.targetLineId === source.id)) throw new Error('此行有翻译或行尾链接，请先处理');
      if (parent.beginUs !== null && source.beginUs !== null && source.beginUs < parent.beginUs || parent.endUs !== null && source.endUs !== null && source.endUs > parent.endUs) throw new Error('背景歌词时间须位于主行区间内');
      const lines = document.lines.filter((line) => line.id !== source.id);
      const parentIndex = lines.findIndex((line) => line.id === parent.id);
      lines.splice(parentIndex + 1, 0, { ...source, backgroundOf: parent.id, agentRefs: [], songPart: null });
      return { ...document, lines };
    }
    case 'delete-line': {
      lineIndex(document, command.lineId);
      const removed = new Set(document.lines.filter((line) => line.id === command.lineId || line.backgroundOf === command.lineId).map((line) => line.id));
      const lines = document.lines.filter((line) => !removed.has(line.id)).map((line) => {
        if (!line.endLink || !removed.has(line.endLink.targetLineId)) return line;
        const endUs = line.endLink.originalEndUs;
        if (endUs !== null && line.words.some((word) => word.endUs !== null && word.endUs > endUs)) throw new Error('Cannot remove linked target: original line end excludes a word');
        return { ...line, endUs, endLink: null };
      });
      const romanizationTracks = document.romanizationTracks.map((track) => ({ ...track, contents: track.contents.filter((content) => !removed.has(content.lineId)) }));
      return { ...document, lines, romanizationTracks };
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
    case 'set-word-alignments':
      return editWord(document, command.lineId, command.wordId, (word) => [{ ...word, alignmentUnits: command.units }]);
    case 'segment-word':
      return editWord(document, command.lineId, command.wordId, (word, line) => {
        if (command.words.length < 2 || command.words.map((part) => part.text).join('') !== word.text || command.words[0].id !== word.id) throw new Error('分词必须保留原文和首词 ID');
        if (word.rubyUnits.length || word.alignmentUnits.length || word.obscene || word.emptyBeat) throw new Error('带附属属性的词不能自动分词');
        const ids = command.words.map((part) => part.id);
        if (new Set(ids).size !== ids.length || ids.slice(1).some((id) => document.lines.some((item) => item.words.some((part) => part.id === id)))) throw new Error('分词 ID 重复');
        for (const part of command.words) {
          if (!part.text || part.rubyUnits.length || part.alignmentUnits.length || part.obscene || part.emptyBeat) throw new Error('分词不能引入附属属性');
          wordFitsLine(part, line);
        }
        if (command.words[0].beginUs !== word.beginUs || command.words.at(-1)?.endUs !== word.endUs) throw new Error('分词必须保留父词时间区间');
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
          if (word.rubyUnits.length || word.alignmentUnits.length || word.obscene || word.emptyBeat) throw new Error('带附属属性的词不能自动分词');
          if (change.words[0].beginUs !== word.beginUs || change.words.at(-1)?.endUs !== word.endUs) throw new Error('分词必须保留父词时间区间');
          for (const [index, part] of change.words.entries()) {
            if (!part.text || part.rubyUnits.length || part.alignmentUnits.length || part.obscene || part.emptyBeat) throw new Error('分词不能引入附属属性');
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
      const index = lineIndex(document, command.lineId);
      const line = document.lines[index];
      const first = line.words.findIndex((word) => word.id === command.firstWordId);
      if (first < 0 || line.words[first + 1]?.id !== command.secondWordId) throw new Error('只能合并相邻词');
      const left = line.words[first], right = line.words[first + 1];
      if ([left, right].some((word) => word.rubyUnits.length || word.alignmentUnits.length || word.obscene || word.emptyBeat)) throw new Error('带附属属性的词不能直接合并');
      const words = line.words.slice();
      const starts = [left.beginUs, right.beginUs].filter((value): value is number => value !== null);
      const ends = [left.endUs, right.endUs].filter((value): value is number => value !== null);
      words.splice(first, 2, { ...left, text: left.text + right.text, beginUs: starts.length ? Math.min(...starts) : null, endUs: ends.length ? Math.max(...ends) : null });
      const lines = document.lines.slice();
      lines[index] = { ...line, words };
      return { ...document, lines };
    }
    case 'merge-ruby-base': {
      const index = lineIndex(document, command.lineId);
      const line = document.lines[index];
      if (command.wordIds.length < 2 || new Set(command.wordIds).size !== command.wordIds.length) throw new Error('至少选择两个相邻词');
      const first = line.words.findIndex((word) => word.id === command.wordIds[0]);
      if (first < 0 || command.wordIds.some((id, offset) => line.words[first + offset]?.id !== id)) throw new Error('Ruby base 必须由同一行相邻词组成');
      const group = line.words.slice(first, first + command.wordIds.length);
      if (group.some((word) => word.rubyUnits.length || word.alignmentUnits.length || word.obscene || word.emptyBeat)) throw new Error('带附属属性的词不能直接合成 Ruby base');
      const starts = group.map((word) => word.beginUs).filter((value): value is number => value !== null);
      const ends = group.map((word) => word.endUs).filter((value): value is number => value !== null);
      const merged = { ...group[0], text: group.map((word) => word.text).join(''), beginUs: starts.length ? Math.min(...starts) : null, endUs: ends.length ? Math.max(...ends) : null };
      const words = line.words.slice();
      words.splice(first, group.length, merged);
      const lines = document.lines.slice();
      lines[index] = { ...line, words };
      return { ...document, lines };
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
      validTime(command.beginUs, command.endUs);
      const index = lineIndex(document, command.lineId);
      const line = document.lines[index];
      if (line.words.some((word) => command.beginUs !== null && word.beginUs !== null && word.beginUs < command.beginUs || command.endUs !== null && word.endUs !== null && word.endUs > command.endUs)) throw new Error('Line time cannot exclude a word');
      if (line.beginUs === command.beginUs && line.endUs === command.endUs) return document;
      const lines = document.lines.slice();
      lines[index] = { ...line, beginUs: command.beginUs, endUs: command.endUs, endLink: line.endUs === command.endUs ? line.endLink : null };
      for (let linkedIndex = 0; linkedIndex < lines.length; linkedIndex++) {
        const linked = lines[linkedIndex];
        if (linked.endLink?.targetLineId !== line.id) continue;
        const linkedEnd = command.beginUs;
        if (linkedEnd === null || linked.words.some((word) => word.endUs !== null && word.endUs > linkedEnd)) throw new Error('Linked line end cannot precede its words');
        validTime(linked.beginUs, linkedEnd);
        lines[linkedIndex] = { ...linked, endUs: linkedEnd };
      }
      return { ...document, lines };
    }
    case 'link-line-end': {
      const index = lineIndex(document, command.lineId);
      const target = document.lines[lineIndex(document, command.targetLineId)];
      const line = document.lines[index];
      if (line.id === target.id || line.backgroundOf || target.backgroundOf || target.beginUs === null) throw new Error('只能链接到其他已定开始时间的主唱行');
      const targetBegin = target.beginUs;
      if (line.words.some((word) => word.endUs !== null && word.endUs > targetBegin)) throw new Error('目标行开始时间早于当前词结束时间');
      validTime(line.beginUs, targetBegin);
      if (line.endLink?.targetLineId === target.id) return document;
      const lines = document.lines.slice();
      lines[index] = { ...line, endUs: targetBegin, endLink: { targetLineId: target.id, originalEndUs: line.endLink?.originalEndUs ?? line.endUs } };
      return { ...document, lines };
    }
    case 'unlink-line-end': {
      const index = lineIndex(document, command.lineId);
      const line = document.lines[index];
      if (!line.endLink) return document;
      const endUs = line.endLink.originalEndUs;
      if (endUs !== null && line.words.some((word) => word.endUs !== null && word.endUs > endUs)) throw new Error('原结束时间早于当前词结束时间');
      const lines = document.lines.slice();
      lines[index] = { ...line, endUs, endLink: null };
      return { ...document, lines };
    }
    case 'set-line-agents': {
      const index = lineIndex(document, command.lineId);
      const line = document.lines[index];
      if (line.backgroundOf) throw new Error('Set agents on the parent line');
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
    case 'set-sublyrics': {
      const index = lineIndex(document, command.lineId);
      if (document.lines[index].backgroundOf) throw new Error('Background vocal sublyrics are not supported');
      const lines = document.lines.slice();
      lines[index] = { ...lines[index], [command.kind]: command.items };
      return { ...document, lines };
    }
    case 'add-romanization-track':
      if (document.romanizationTracks.some((track) => track.id === command.track.id)) throw new Error('音译轨道 ID 重复');
      if (command.track.contents.length) throw new Error('新轨道必须为空');
      return { ...document, romanizationTracks: [...document.romanizationTracks, command.track] };
    case 'delete-romanization-track':
      if (!document.romanizationTracks.some((track) => track.id === command.trackId)) throw new Error('音译轨道不存在');
      return { ...document, romanizationTracks: document.romanizationTracks.filter((track) => track.id !== command.trackId) };
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
        if (contentIndex >= 0) throw new Error('音译内容 ID 重复');
        if (!document.lines.some((line) => line.id === command.content.lineId && !line.backgroundOf)) throw new Error('音译主行不存在');
        contents = [...track.contents, command.content];
      } else {
        if (contentIndex < 0) throw new Error('音译内容不存在');
        if (command.type === 'set-romanization-content') {
          if (!document.lines.some((line) => line.id === command.content.lineId && !line.backgroundOf)) throw new Error('音译主行不存在');
          contents = track.contents.slice(); contents[contentIndex] = command.content;
        } else contents = track.contents.filter((content) => content.id !== command.contentId);
      }
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
    case 'set-agents':
      if (command.agents.some((agent) => !/^[A-Za-z_][\w.-]*$/.test(agent.id)) || new Set(command.agents.map((agent) => agent.id)).size !== command.agents.length) throw new Error('Invalid or duplicate agent ID');
      if (document.lines.some((line) => line.agentRefs.some((ref) => !command.agents.some((agent) => agent.id === ref)))) throw new Error('An assigned agent cannot be removed');
      return { ...document, agents: command.agents };
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
        if (word.rubyUnits.length) throw new Error('Splitting a Ruby base requires an explicit reading split');
        if (word.obscene || word.emptyBeat || word.alignmentUnits.length) throw new Error('Splitting a word with attached properties requires explicit redistribution');
        const [left, right] = splitAtGrapheme(word.text, wordCommand.at);
        const newId = wordCommand.newWordId ?? crypto.randomUUID();
        if (line.words.some((item) => item.id === newId)) throw new Error('Word id already exists');
        const middle = splitTime(word.beginUs, word.endUs, Array.from(left).length, Array.from(word.text).length);
        return [
          { ...word, text: left, endUs: middle },
          { ...createWord(right, newId), beginUs: middle, endUs: word.endUs },
        ];
      }
      case 'edit-word':
        if (!wordCommand.text) throw new Error('Word text must be non-empty');
        return [wordCommand.text === word.text ? word : { ...word, text: wordCommand.text, alignmentUnits: [] }];
      case 'set-word-time':
        validTime(wordCommand.beginUs, wordCommand.endUs);
        if (line.beginUs !== null && wordCommand.beginUs !== null && wordCommand.beginUs < line.beginUs) throw new Error('Word starts before line');
        if (line.endUs !== null && wordCommand.endUs !== null && wordCommand.endUs > line.endUs) throw new Error('Word ends after line');
        if (word.rubyUnits.some((unit) => wordCommand.beginUs !== null && unit.beginUs !== null && unit.beginUs < wordCommand.beginUs || wordCommand.endUs !== null && unit.endUs !== null && unit.endUs > wordCommand.endUs)) throw new Error('Word time cannot exclude a Ruby unit');
        return [word.beginUs === wordCommand.beginUs && word.endUs === wordCommand.endUs ? word : { ...word, beginUs: wordCommand.beginUs, endUs: wordCommand.endUs }];
      case 'add-ruby': {
        if (!wordCommand.reading) throw new Error('Ruby reading must be non-empty');
        const id = wordCommand.rubyId ?? crypto.randomUUID();
        if (word.rubyUnits.some((unit) => unit.id === id)) throw new Error('Ruby unit id already exists');
        return [{ ...word, rubyUnits: [...word.rubyUnits, { id, reading: wordCommand.reading, beginUs: null, endUs: null }] }];
      }
      case 'insert-ruby': {
        if (!wordCommand.reading) throw new Error('Ruby reading must be non-empty');
        const id = wordCommand.rubyId ?? crypto.randomUUID();
        if (word.rubyUnits.some((unit) => unit.id === id)) throw new Error('Ruby unit id already exists');
        const after = wordCommand.afterRubyId === null ? -1 : word.rubyUnits.findIndex((unit) => unit.id === wordCommand.afterRubyId);
        if (wordCommand.afterRubyId !== null && after < 0) throw new Error('Ruby insertion anchor not found');
        const rubyUnits = word.rubyUnits.slice();
        rubyUnits.splice(after + 1, 0, { id, reading: wordCommand.reading, beginUs: null, endUs: null });
        return [{ ...word, rubyUnits }];
      }
      case 'merge-ruby': {
        const first = word.rubyUnits.findIndex((unit) => unit.id === wordCommand.firstRubyId);
        if (first < 0 || word.rubyUnits[first + 1]?.id !== wordCommand.secondRubyId) throw new Error('只能合并相邻读音单元');
        if (word.alignmentUnits.some((unit) => unit.rubyUnitId === wordCommand.firstRubyId || unit.rubyUnitId === wordCommand.secondRubyId)) throw new Error('带对齐结果的读音单元不能直接合并');
        const left = word.rubyUnits[first], right = word.rubyUnits[first + 1];
        const starts = [left.beginUs, right.beginUs].filter((value): value is number => value !== null);
        const ends = [left.endUs, right.endUs].filter((value): value is number => value !== null);
        const rubyUnits = word.rubyUnits.slice();
        rubyUnits.splice(first, 2, { ...left, reading: left.reading + right.reading, beginUs: starts.length ? Math.min(...starts) : null, endUs: ends.length ? Math.max(...ends) : null });
        return [{ ...word, rubyUnits }];
      }
      case 'set-ruby-units': {
        if (word.rubyUnits.length && !wordCommand.overwrite) throw new Error('已有手动 Ruby，需明确选择覆盖');
        if (!wordCommand.units.length || wordCommand.units.some((unit) => !unit.reading)) throw new Error('Ruby reading must be non-empty');
        if (new Set(wordCommand.units.map((unit) => unit.id)).size !== wordCommand.units.length) throw new Error('Ruby unit id already exists');
        for (const unit of wordCommand.units) {
          validTime(unit.beginUs, unit.endUs);
          if (word.beginUs !== null && unit.beginUs !== null && unit.beginUs < word.beginUs || word.endUs !== null && unit.endUs !== null && unit.endUs > word.endUs) throw new Error('Ruby unit time exceeds word');
        }
        return [{ ...word, rubyUnits: wordCommand.units, alignmentUnits: word.alignmentUnits.filter((unit) => !unit.rubyUnitId) }];
      }
      case 'redistribute-ruby-time':
        if (word.alignmentUnits.some((unit) => unit.rubyUnitId)) throw new Error('带对齐结果的读音不能自动重分配时间');
        return [{ ...word, rubyUnits: distributeRubyTime(word, word.rubyUnits) }];
      case 'set-word-empty-beat':
        if (!Number.isSafeInteger(wordCommand.emptyBeat) || wordCommand.emptyBeat < 0 || wordCommand.emptyBeat > 32) throw new Error('空拍数必须是 0–32 的整数');
        return [word.emptyBeat === wordCommand.emptyBeat ? word : { ...word, emptyBeat: wordCommand.emptyBeat }];
      case 'split-ruby':
        return [updateRuby(word, wordCommand.rubyId, (unit) => {
          if (word.alignmentUnits.some((item) => item.rubyUnitId === unit.id)) throw new Error('带对齐结果的读音不能直接拆分');
          const [left, right] = splitAtGrapheme(unit.reading, wordCommand.at);
          const id = wordCommand.newRubyId ?? crypto.randomUUID();
          if (word.rubyUnits.some((item) => item.id === id)) throw new Error('Ruby unit id already exists');
          const middle = splitTime(unit.beginUs, unit.endUs, splitReadingMora(left).length, splitReadingMora(unit.reading).length);
          return [{ ...unit, reading: left, endUs: middle }, { id, reading: right, beginUs: middle, endUs: unit.endUs }];
        })];
      case 'edit-ruby': {
        if (!wordCommand.reading) throw new Error('Ruby reading must be non-empty');
        const updated = updateRuby(word, wordCommand.rubyId, (unit) => wordCommand.reading === unit.reading ? [unit] : [{ ...unit, reading: wordCommand.reading }]);
        return [updated === word ? word : { ...updated, alignmentUnits: word.alignmentUnits.filter((unit) => unit.rubyUnitId !== wordCommand.rubyId) }];
      }
      case 'delete-ruby':
        return [{ ...updateRuby(word, wordCommand.rubyId, () => []), alignmentUnits: word.alignmentUnits.filter((unit) => unit.rubyUnitId !== wordCommand.rubyId) }];
      case 'set-ruby-time': {
        validTime(wordCommand.beginUs, wordCommand.endUs);
        if (word.beginUs !== null && wordCommand.beginUs !== null && wordCommand.beginUs < word.beginUs || word.endUs !== null && wordCommand.endUs !== null && wordCommand.endUs > word.endUs) throw new Error('Ruby unit time exceeds word');
        const updated = updateRuby(word, wordCommand.rubyId, (unit) => unit.beginUs === wordCommand.beginUs && unit.endUs === wordCommand.endUs ? [unit] : [{ ...unit, beginUs: wordCommand.beginUs, endUs: wordCommand.endUs }]);
        if (updated === word) return [word];
        const beginUs = word.beginUs ?? (updated.rubyUnits.every((unit) => unit.beginUs !== null) ? Math.min(...updated.rubyUnits.map((unit) => unit.beginUs!)) : null);
        const endUs = word.endUs ?? (updated.rubyUnits.every((unit) => unit.endUs !== null) ? Math.max(...updated.rubyUnits.map((unit) => unit.endUs!)) : null);
        return [{ ...updated, beginUs, endUs }];
      }
    }
  });
}

export function executeLyricCommand(state: LyricEditorState, command: LyricCommand): LyricEditorState {
  const next = command.type === 'batch' ? command.commands.reduce(applyAtomic, state.present) : applyAtomic(state.present, command);
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
