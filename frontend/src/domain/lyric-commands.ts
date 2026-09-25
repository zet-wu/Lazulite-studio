import { createLine, createWord, type LyricAgent, type LyricDocument, type LyricLine, type LyricWord, type RubyUnit, type SubLyric, type TimeUs } from './lyric-document';
import { splitAtGrapheme } from './text-boundaries';

const MAX_HISTORY = 256;

export type LyricCommand =
  | { type: 'insert-line'; afterLineId: string | null; line?: LyricLine }
  | { type: 'delete-line'; lineId: string }
  | { type: 'move-line'; lineId: string; afterLineId: string | null }
  | { type: 'insert-word'; lineId: string; afterWordId: string | null; word: LyricWord }
  | { type: 'delete-word'; lineId: string; wordId: string }
  | { type: 'set-line-time'; lineId: string; beginUs: TimeUs; endUs: TimeUs }
  | { type: 'set-sublyrics'; lineId: string; kind: 'translations' | 'romanizations'; items: SubLyric[] }
  | { type: 'set-agents'; agents: LyricAgent[] }
  | { type: 'replace-document'; document: LyricDocument }
  | { type: 'split-word'; lineId: string; wordId: string; at: number; newWordId?: string }
  | { type: 'edit-word'; lineId: string; wordId: string; text: string }
  | { type: 'set-word-time'; lineId: string; wordId: string; beginUs: TimeUs; endUs: TimeUs }
  | { type: 'add-ruby'; lineId: string; wordId: string; reading: string; rubyId?: string }
  | { type: 'split-ruby'; lineId: string; wordId: string; rubyId: string; at: number; newRubyId?: string }
  | { type: 'edit-ruby'; lineId: string; wordId: string; rubyId: string; reading: string };

type WordCommand = Extract<LyricCommand, { type: 'split-word' | 'edit-word' | 'set-word-time' | 'add-ruby' | 'split-ruby' | 'edit-ruby' }>

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

function applyStructure(document: LyricDocument, command: LyricCommand): LyricDocument | null {
  switch (command.type) {
    case 'insert-line': {
      const line = command.line ?? createLine('');
      if (document.lines.some((item) => item.id === line.id)) throw new Error(`Line id already exists: ${line.id}`);
      if (line.backgroundOf) throw new Error('Insert a background vocal with its parent line');
      const after = command.afterLineId === null ? -1 : lineIndex(document, command.afterLineId);
      const lines = document.lines.slice();
      lines.splice(after + 1, 0, line);
      return { ...document, lines };
    }
    case 'delete-line': {
      lineIndex(document, command.lineId);
      const lines = document.lines.filter((line) => line.id !== command.lineId && line.backgroundOf !== command.lineId);
      return { ...document, lines };
    }
    case 'move-line': {
      const index = lineIndex(document, command.lineId);
      const line = document.lines[index];
      if (line.backgroundOf) throw new Error('Move the parent line to move its background vocal');
      const group = document.lines.filter((item) => item.id === line.id || item.backgroundOf === line.id);
      const rest = document.lines.filter((item) => !group.includes(item));
      if (command.afterLineId !== null && group.some((item) => item.id === command.afterLineId)) throw new Error('Cannot move a line after itself');
      const after = command.afterLineId === null ? -1 : lineIndex({ ...document, lines: rest }, command.afterLineId);
      rest.splice(after + 1, 0, ...group);
      return rest.every((item, i) => item === document.lines[i]) ? document : { ...document, lines: rest };
    }
    case 'insert-word': {
      const index = lineIndex(document, command.lineId);
      const line = document.lines[index];
      if (document.lines.some((item) => item.words.some((word) => word.id === command.word.id))) throw new Error(`Word id already exists: ${command.word.id}`);
      if (!command.word.text) throw new Error('Word text must be non-empty');
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
    case 'set-line-time': {
      validTime(command.beginUs, command.endUs);
      const index = lineIndex(document, command.lineId);
      const line = document.lines[index];
      if (line.words.some((word) => command.beginUs !== null && word.beginUs !== null && word.beginUs < command.beginUs || command.endUs !== null && word.endUs !== null && word.endUs > command.endUs)) throw new Error('Line time cannot exclude a word');
      if (line.beginUs === command.beginUs && line.endUs === command.endUs) return document;
      const lines = document.lines.slice();
      lines[index] = { ...line, beginUs: command.beginUs, endUs: command.endUs };
      return { ...document, lines };
    }
    case 'set-sublyrics': {
      const index = lineIndex(document, command.lineId);
      const lines = document.lines.slice();
      lines[index] = { ...lines[index], [command.kind]: command.items };
      return { ...document, lines };
    }
    case 'set-agents':
      if (document.lines.some((line) => line.agentRefs.some((ref) => !command.agents.some((agent) => agent.id === ref)))) throw new Error('An assigned agent cannot be removed');
      return { ...document, agents: command.agents };
    case 'replace-document':
      return command.document;
    default:
      return null;
  }
}

export function executeLyricCommand(state: LyricEditorState, command: LyricCommand): LyricEditorState {
  const structured = applyStructure(state.present, command);
  const wordCommand = command as WordCommand;
  const next = structured ?? editWord(state.present, wordCommand.lineId, wordCommand.wordId, (word, line) => {
    switch (wordCommand.type) {
      case 'split-word': {
        if (word.rubyUnits.length) throw new Error('Splitting a Ruby base requires an explicit reading split');
        if (word.romanization || word.obscene || word.emptyBeat) throw new Error('Splitting a word with attached properties requires explicit redistribution');
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
        return [wordCommand.text === word.text ? word : { ...word, text: wordCommand.text }];
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
      case 'split-ruby':
        return [updateRuby(word, wordCommand.rubyId, (unit) => {
          const [left, right] = splitAtGrapheme(unit.reading, wordCommand.at);
          const id = wordCommand.newRubyId ?? crypto.randomUUID();
          if (word.rubyUnits.some((item) => item.id === id)) throw new Error('Ruby unit id already exists');
          const middle = splitTime(unit.beginUs, unit.endUs, Array.from(left).length, Array.from(unit.reading).length);
          return [{ ...unit, reading: left, endUs: middle }, { id, reading: right, beginUs: middle, endUs: unit.endUs }];
        })];
      case 'edit-ruby':
        if (!wordCommand.reading) throw new Error('Ruby reading must be non-empty');
        return [updateRuby(word, wordCommand.rubyId, (unit) => wordCommand.reading === unit.reading ? [unit] : [{ ...unit, reading: wordCommand.reading }])];
    }
  });
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
