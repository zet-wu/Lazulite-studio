import { createWord, type LyricDocument, type LyricLine, type LyricWord, type RubyUnit, type TimeUs } from './lyric-document';
import { splitAtGrapheme } from './text-boundaries';

const MAX_HISTORY = 256;

export type LyricCommand =
  | { type: 'split-word'; lineId: string; wordId: string; at: number; newWordId?: string }
  | { type: 'edit-word'; lineId: string; wordId: string; text: string }
  | { type: 'set-word-time'; lineId: string; wordId: string; beginUs: TimeUs; endUs: TimeUs }
  | { type: 'add-ruby'; lineId: string; wordId: string; reading: string; rubyId?: string }
  | { type: 'split-ruby'; lineId: string; wordId: string; rubyId: string; at: number; newRubyId?: string }
  | { type: 'edit-ruby'; lineId: string; wordId: string; rubyId: string; reading: string };

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

export function executeLyricCommand(state: LyricEditorState, command: LyricCommand): LyricEditorState {
  const { lineId, wordId } = command;
  const next = editWord(state.present, lineId, wordId, (word, line) => {
    switch (command.type) {
      case 'split-word': {
        if (word.rubyUnits.length) throw new Error('Splitting a Ruby base requires an explicit reading split');
        if (word.romanization || word.obscene || word.emptyBeat) throw new Error('Splitting a word with attached properties requires explicit redistribution');
        const [left, right] = splitAtGrapheme(word.text, command.at);
        const newId = command.newWordId ?? crypto.randomUUID();
        if (line.words.some((item) => item.id === newId)) throw new Error('Word id already exists');
        const middle = splitTime(word.beginUs, word.endUs, Array.from(left).length, Array.from(word.text).length);
        return [
          { ...word, text: left, endUs: middle },
          { ...createWord(right, newId), beginUs: middle, endUs: word.endUs },
        ];
      }
      case 'edit-word':
        if (!command.text) throw new Error('Word text must be non-empty');
        return [command.text === word.text ? word : { ...word, text: command.text }];
      case 'set-word-time':
        validTime(command.beginUs, command.endUs);
        if (line.beginUs !== null && command.beginUs !== null && command.beginUs < line.beginUs) throw new Error('Word starts before line');
        if (line.endUs !== null && command.endUs !== null && command.endUs > line.endUs) throw new Error('Word ends after line');
        if (word.rubyUnits.some((unit) => command.beginUs !== null && unit.beginUs !== null && unit.beginUs < command.beginUs || command.endUs !== null && unit.endUs !== null && unit.endUs > command.endUs)) throw new Error('Word time cannot exclude a Ruby unit');
        return [word.beginUs === command.beginUs && word.endUs === command.endUs ? word : { ...word, beginUs: command.beginUs, endUs: command.endUs }];
      case 'add-ruby': {
        if (!command.reading) throw new Error('Ruby reading must be non-empty');
        const id = command.rubyId ?? crypto.randomUUID();
        if (word.rubyUnits.some((unit) => unit.id === id)) throw new Error('Ruby unit id already exists');
        return [{ ...word, rubyUnits: [...word.rubyUnits, { id, reading: command.reading, beginUs: null, endUs: null }] }];
      }
      case 'split-ruby':
        return [updateRuby(word, command.rubyId, (unit) => {
          const [left, right] = splitAtGrapheme(unit.reading, command.at);
          const id = command.newRubyId ?? crypto.randomUUID();
          if (word.rubyUnits.some((item) => item.id === id)) throw new Error('Ruby unit id already exists');
          const middle = splitTime(unit.beginUs, unit.endUs, Array.from(left).length, Array.from(unit.reading).length);
          return [{ ...unit, reading: left, endUs: middle }, { id, reading: right, beginUs: middle, endUs: unit.endUs }];
        })];
      case 'edit-ruby':
        if (!command.reading) throw new Error('Ruby reading must be non-empty');
        return [updateRuby(word, command.rubyId, (unit) => command.reading === unit.reading ? [unit] : [{ ...unit, reading: command.reading }])];
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
