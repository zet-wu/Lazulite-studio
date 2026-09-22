import type { TtmlAttribute, TtmlNode, TimeUs } from './ttml';
export const STUDIO_SCHEMA_VERSION = 'studio-lyric-v1' as const;
export type InlineNode = {
    kind: 'text';
    text: string;
    editable: boolean;
} | {
    kind: 'element';
    name: string;
    children: InlineNode[];
    editable: boolean;
    reason?: string;
    raw?: TtmlNode;
};
export type SourceTiming = {
    begin: string | null;
    end: string | null;
    dur: string | null;
    parentBeginUs: number;
    parentEndUs: number | null;
    parentPath: number[];
    relative: boolean;
};
export type StudioRuby = {
    id: string;
    base: string;
    reading: string;
    baseStart: number;
    baseEnd: number;
};
export type TimingUnitKind = 'word' | 'mora' | 'phoneme';
/** Fine timing uses code-point coordinates; reading coordinates are independent. */
export type TimingUnit = {
    id: string;
    kind: TimingUnitKind;
    textStart: number;
    textEnd: number;
    readingStart: number | null;
    readingEnd: number | null;
    rubyId: string | null;
    beginUs: TimeUs;
    endUs: TimeUs;
};
export type StudioLine = {
    id: string;
    sourceLineId?: string;
    xmlId: string | null;
    text: string;
    beginUs: TimeUs;
    endUs: TimeUs;
    agentRefs: string[];
    inline: InlineNode[];
    ruby: StudioRuby[];
    timingUnits: TimingUnit[];
    sourcePath: number[];
    parentPath: number[];
    sourceTiming: SourceTiming;
    /** Original line attributes, used to preserve metadata through structural edits. */
    sourceAttributes: TtmlAttribute[];
    editable: {
        text: boolean;
        timing: boolean;
    };
    locks: {
        text?: string;
        timing?: string;
    };
    baseline: Pick<StudioLine, 'text' | 'beginUs' | 'endUs' | 'agentRefs' | 'ruby' | 'timingUnits'>;
};
export type StudioAgent = {
    id: string;
    name: string | null;
    type: string | null;
    actorRef: string | null;
    groupRefs: string[];
    sourcePath: number[];
    raw: TtmlNode;
};
export type StudioLyricDocument = {
    schemaVersion: typeof STUDIO_SCHEMA_VERSION;
    rawXml: string;
    baseline: {
        xml: string;
        root: TtmlNode;
    };
    root: TtmlNode;
    blocks: TtmlNode[];
    lines: StudioLine[];
    agents: StudioAgent[];
    language: string | null;
    metadata: TtmlNode[];
    extensions: TtmlNode[];
    profile: {
        category: 'editable' | 'mixed' | 'read-only';
        reasons: string[];
    };
    issues: {
        code: string;
        message: string;
        path?: number[];
    }[];
};
