/** The semantic editor document. Transport, XML trees and playback stay outside it. */
export const LYRIC_SCHEMA_VERSION = 'studio-lyric-v2' as const;

export type TimeUs = number | null;

export type RubyUnit = {
  id: string;
  reading: string;
  beginUs: TimeUs;
  endUs: TimeUs;
};

export type LyricWord = {
  id: string;
  text: string;
  beginUs: TimeUs;
  endUs: TimeUs;
  romanization: string;
  rubyUnits: RubyUnit[];
  obscene: boolean;
  emptyBeat: number;
};

export type SubLyric = { language: string | null; text: string };

export type LyricLine = {
  id: string;
  words: LyricWord[];
  beginUs: TimeUs;
  endUs: TimeUs;
  agentRefs: string[];
  backgroundOf: string | null;
  songPart: string | null;
  duet: boolean;
  translations: SubLyric[];
  romanizations: SubLyric[];
  ignoreSync: boolean;
};

export type LyricAgent = {
  id: string;
  name: string | null;
  type: string | null;
};

export type LyricDocument = {
  schemaVersion: typeof LYRIC_SCHEMA_VERSION;
  lines: LyricLine[];
  agents: LyricAgent[];
  metadata: Record<string, string[]>;
  language: string | null;
};

export const lineText = (line: LyricLine) => line.words.map((word) => word.text).join('');
export const rubyReading = (word: LyricWord) => word.rubyUnits.map((unit) => unit.reading).join('');

export function createWord(text: string, id: string = crypto.randomUUID()): LyricWord {
  return { id, text, beginUs: null, endUs: null, romanization: '', rubyUnits: [], obscene: false, emptyBeat: 0 };
}

export function createLine(text: string, id: string = `line-${crypto.randomUUID()}`): LyricLine {
  return {
    id, words: text ? [createWord(text, `${id}:word:0`)] : [],
    beginUs: null, endUs: null, agentRefs: [], backgroundOf: null, songPart: null,
    duet: false, translations: [], romanizations: [], ignoreSync: false,
  };
}

export function createLyricDocument(text = ''): LyricDocument {
  return { schemaVersion: LYRIC_SCHEMA_VERSION, lines: [createLine(text)], agents: [], metadata: {}, language: null };
}
