/** The semantic editor document. Transport, XML trees and playback stay outside it. */
export const LYRIC_SCHEMA_VERSION = 'studio-lyric-v10' as const;

export type TimeMs = number | null;

export type RubyUnit = {
  id: string;
  reading: string;
  beginMs: TimeMs;
  endMs: TimeMs;
};

export type LyricWord = {
  id: string;
  text: string;
  beginMs: TimeMs;
  endMs: TimeMs;
  rubyUnits: RubyUnit[];
  obscene: boolean;
  agentRefs?: string[];
};

export type RomanizationUnit = { id: string; text: string; beginMs: TimeMs; endMs: TimeMs };
export type RomanizationContent = { id: string; lineId: string } & (
  | { kind: 'plain'; text: string }
  | { kind: 'timed'; units: RomanizationUnit[] }
);
export type RomanizationTrack = { id: string; language: string | null; contents: RomanizationContent[] };

export type TranslationContent = RomanizationContent;
export type TranslationTrack = { id: string; language: string | null; purpose: 'subtitle' | 'replacement'; contents: TranslationContent[] };
export const translationText = (item: TranslationContent) => item.kind === 'plain' ? item.text : item.units.map(unit => unit.text).join('');
export const plainTranslation = (text: string, lineId: string): TranslationContent => ({ id: crypto.randomUUID(), lineId, kind: 'plain', text });
export const translationsForLine = (document: LyricDocument, lineId: string) => document.translationTracks.flatMap(track => track.contents.filter(content => content.lineId === lineId));

export type LyricLine = {
  id: string;
  words: LyricWord[];
  beginMs: TimeMs;
  endMs: TimeMs;
  agentRefs: string[];
  backgroundOf: string | null;
  songPart: string | null;
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
  translationTracks: TranslationTrack[];
  agents: LyricAgent[];
  metadata: Record<string, string[]>;
  language: string | null;
};

export const lineText = (line: LyricLine) => line.words.map((word) => word.text).join('');
export const rubyReading = (word: LyricWord) => word.rubyUnits.map((unit) => unit.reading).join('');

export function createWord(text: string, id: string = crypto.randomUUID()): LyricWord {
  return { id, text, beginMs: null, endMs: null, rubyUnits: [], obscene: false };
}

export function createLine(text: string, id: string = `line-${crypto.randomUUID()}`): LyricLine {
  return {
    id, words: text ? [createWord(text, `${id}:word:0`)] : [],
    beginMs: null, endMs: null, agentRefs: [], backgroundOf: null, songPart: null,
  };
}

export function createLyricDocument(text = ''): LyricDocument {
  return { schemaVersion: LYRIC_SCHEMA_VERSION, lines: [createLine(text)], romanizationTracks: [], translationTracks: [], agents: [], metadata: {}, language: null };
}
