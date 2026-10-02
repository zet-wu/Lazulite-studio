/** The semantic editor document. Transport, XML trees and playback stay outside it. */
export const LYRIC_SCHEMA_VERSION = 'studio-lyric-v6' as const;

export type TimeMs = number | null;

export type RubyUnit = {
  id: string;
  reading: string;
  beginMs: TimeMs;
  endMs: TimeMs;
};

export type AlignmentUnit = {
  id: string;
  kind: 'word' | 'mora' | 'phoneme';
  text: string;
  beginMs: TimeMs;
  endMs: TimeMs;
  readingStart: number | null;
  readingEnd: number | null;
  rubyUnitId: string | null;
};

export type LyricWord = {
  id: string;
  text: string;
  beginMs: TimeMs;
  endMs: TimeMs;
  rubyUnits: RubyUnit[];
  alignmentUnits: AlignmentUnit[];
  obscene: boolean;
  emptyBeat: number;
};

export type SubLyric = { language: string | null; text: string };
export type RomanizationUnit = { id: string; text: string; beginMs: TimeMs; endMs: TimeMs };
export type RomanizationContent = { id: string; lineId: string } & (
  | { kind: 'plain'; text: string }
  | { kind: 'timed'; units: RomanizationUnit[] }
);
export type RomanizationTrack = { id: string; language: string | null; contents: RomanizationContent[] };

export type LyricLine = {
  id: string;
  words: LyricWord[];
  beginMs: TimeMs;
  endMs: TimeMs;
  endLink: { targetLineId: string; originalEndMs: TimeMs } | null;
  agentRefs: string[];
  backgroundOf: string | null;
  songPart: string | null;
  translations: SubLyric[];
  ignoreSync: boolean;
};

export const AGENT_TYPES = ['person', 'character', 'group', 'organization', 'other'] as const;

export type LyricAgent = {
  actorRef?: string;
  id: string;
  name: string | null;
  type: string | null;
};

export type LyricDocument = {
  schemaVersion: typeof LYRIC_SCHEMA_VERSION;
  lines: LyricLine[];
  romanizationTracks: RomanizationTrack[];
  agents: LyricAgent[];
  metadata: Record<string, string[]>;
  language: string | null;
};

export const lineText = (line: LyricLine) => line.words.map((word) => word.text).join('');
export const rubyReading = (word: LyricWord) => word.rubyUnits.map((unit) => unit.reading).join('');

export function createWord(text: string, id: string = crypto.randomUUID()): LyricWord {
  return { id, text, beginMs: null, endMs: null, rubyUnits: [], alignmentUnits: [], obscene: false, emptyBeat: 0 };
}

export function createLine(text: string, id: string = `line-${crypto.randomUUID()}`): LyricLine {
  return {
    id, words: text ? [createWord(text, `${id}:word:0`)] : [],
    beginMs: null, endMs: null, endLink: null, agentRefs: [], backgroundOf: null, songPart: null,
    translations: [], ignoreSync: false,
  };
}

export function createLyricDocument(text = ''): LyricDocument {
  return { schemaVersion: LYRIC_SCHEMA_VERSION, lines: [createLine(text)], romanizationTracks: [], agents: [], metadata: {}, language: null };
}
