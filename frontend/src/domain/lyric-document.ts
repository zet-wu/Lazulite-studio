/** The semantic editor document. Transport, XML trees and playback stay outside it. */
export const LYRIC_SCHEMA_VERSION = 'studio-lyric-v7' as const;

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
  emptyBeat: number;
};

export type SubLyric = { trackId: string; trackOrder: number; contentOrder: number; id: string; language: string | null; purpose: 'subtitle' | 'replacement' } & (
  | { kind: 'plain'; text: string }
  | { kind: 'timed'; units: RomanizationUnit[] }
);
export const translationText = (item: SubLyric) => item.kind === 'plain' ? item.text : item.units.map(unit => unit.text).join('');
export const plainTranslation = (text: string, language: string | null = null): SubLyric => ({ trackId: crypto.randomUUID(), trackOrder: 0, contentOrder: 0, id: crypto.randomUUID(), language, purpose: 'subtitle', kind: 'plain', text });
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
  endLink: { targetLineId: string } | null;
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
  return { id, text, beginMs: null, endMs: null, rubyUnits: [], obscene: false, emptyBeat: 0 };
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
