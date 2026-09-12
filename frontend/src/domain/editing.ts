import type { StudioLine, StudioLyricDocument, StudioRuby } from './document';
import type { TimeUs } from './ttml';

const MAX_HISTORY = 20;

export type WorkflowSidecar = {
  lineReviews?: Record<string, { status: 'confirmed' | 'needs-review' }>;
  rubyReviews?: Record<string, { status: 'confirmed' | 'needs-review' }>;
};
export type StudioDocument = StudioLyricDocument;

export type LineUpdate = Partial<Pick<StudioLine, 'text' | 'beginUs' | 'endUs' | 'agentRefs'>>;
export type EditCommand =
  | { type: 'update-line'; lineId: string; changes: LineUpdate }
  | { type: 'update-lines'; updates: Array<{ lineId: string; changes: LineUpdate }> }
  | { type: 'update-ruby'; lineId: string; ruby: StudioRuby[]; review?: 'confirmed' | 'needs-review' }
  | { type: 'update-agents'; agents: StudioDocument['agents'] }
  | { type: 'replace-document'; document: StudioDocument; workflow?: WorkflowSidecar };

export type EditorSnapshot = { document: StudioDocument; workflow?: WorkflowSidecar };
export type EditorState = {
  present: EditorSnapshot;
  past: EditorSnapshot[];
  future: EditorSnapshot[];
};

const codePoints = (value: string) => Array.from(value);

export function validateRubySpans(text: string, ruby: StudioRuby[]): void {
  if (!Array.isArray(ruby)) throw new Error('Ruby spans must be an array');
  const seen = new Set<string>();
  const ordered = [...ruby].sort((left, right) => left.baseStart - right.baseStart || left.baseEnd - right.baseEnd);
  let previousEnd = 0;
  const points = codePoints(text);
  for (const span of ordered) {
    if (!span || typeof span.id !== 'string' || !span.id || seen.has(span.id)) throw new Error('Ruby ids must be unique and non-empty');
    seen.add(span.id);
    if (typeof span.base !== 'string' || typeof span.reading !== 'string' || span.base.length === 0 || span.reading.length === 0) throw new Error('Ruby base and reading must be non-empty');
    if (!Number.isSafeInteger(span.baseStart) || !Number.isSafeInteger(span.baseEnd) || span.baseStart < 0 || span.baseEnd <= span.baseStart || span.baseEnd > points.length) throw new Error('Ruby range must be a non-empty code-point range within the line');
    if (span.baseStart < previousEnd) throw new Error('Ruby ranges must not overlap');
    if (points.slice(span.baseStart, span.baseEnd).join('') !== span.base) throw new Error('Ruby base does not match the current line text');
    previousEnd = span.baseEnd;
  }
}

const clone = <T>(value: T): T => {
  if (value === undefined) return value;
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
};

export function createEditorState(document: StudioDocument, workflow?: WorkflowSidecar): EditorState {
  return { present: { document: clone(document), workflow: workflow ? clone(workflow) : undefined }, past: [], future: [] };
}

const validTime = (value: unknown): value is TimeUs => value === null || (Number.isSafeInteger(value) && (value as number) >= 0);
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

function validateChanges(changes: LineUpdate): void {
  const keys = Object.keys(changes);
  if (keys.some((key) => !['text', 'beginUs', 'endUs', 'agentRefs'].includes(key))) throw new Error('Unsupported line field');
  if ('text' in changes && typeof changes.text !== 'string') throw new Error('Line text must be a string');
  if ('beginUs' in changes && !validTime(changes.beginUs)) throw new Error('beginUs must be a non-negative integer or null');
  if ('endUs' in changes && !validTime(changes.endUs)) throw new Error('endUs must be a non-negative integer or null');
  if ('agentRefs' in changes && (!Array.isArray(changes.agentRefs) || changes.agentRefs.some((id) => typeof id !== 'string'))) throw new Error('agentRefs must be string ids');
}

function applyUpdates(snapshot: EditorSnapshot, updates: Array<{ lineId: string; changes: LineUpdate }>): EditorSnapshot {
  const document = clone(snapshot.document);
  const workflow = clone(snapshot.workflow);
  if (document.profile.category === 'read-only') throw new Error('Document is read-only');
  const ids = new Set<string>();
  for (const update of updates) {
    if (!update.lineId || ids.has(update.lineId)) throw new Error('Duplicate or missing line id');
    ids.add(update.lineId);
    validateChanges(update.changes);
    const line = document.lines.find((item) => item.id === update.lineId);
    if (!line) throw new Error(`Line not found: ${update.lineId}`);
    const changedText = 'text' in update.changes && update.changes.text !== line.text;
    const changedBegin = 'beginUs' in update.changes && update.changes.beginUs !== line.beginUs;
    const changedEnd = 'endUs' in update.changes && update.changes.endUs !== line.endUs;
    const changedAgents = 'agentRefs' in update.changes && JSON.stringify(update.changes.agentRefs) !== JSON.stringify(line.agentRefs);
    if (!changedText && !changedBegin && !changedEnd && !changedAgents) continue;
    if (changedText && !line.editable.text) throw new Error('Lines with Ruby or structured text are read-only');
    if (changedText && line.ruby.length) {
      validateRubySpans(update.changes.text!, line.ruby);
      if (line.ruby.some((span) => Array.from(line.text).slice(span.baseStart, span.baseEnd).join('') !== span.base)) throw new Error('Ruby cannot be safely remapped after text editing');
    }
    if ((changedBegin || changedEnd) && !line.editable.timing) throw new Error('Line timing is read-only');
    if (changedAgents && update.changes.agentRefs!.some((id) => !document.agents.some((agent) => agent.id === id))) throw new Error('Line references an unknown agent');
    const nextBegin = 'beginUs' in update.changes ? update.changes.beginUs! : line.beginUs;
    const nextEnd = 'endUs' in update.changes ? update.changes.endUs! : line.endUs;
    if (nextBegin !== null && nextEnd !== null && nextBegin > nextEnd) throw new Error('Line beginUs must be <= endUs');
    if (nextBegin !== null && nextBegin < line.sourceTiming.parentBeginUs) throw new Error('Line beginUs precedes its parent timing');
    if (nextEnd !== null && nextEnd < line.sourceTiming.parentBeginUs) throw new Error('Line endUs precedes its parent timing');
    if (line.sourceTiming.parentEndUs !== null && nextBegin !== null && nextBegin > line.sourceTiming.parentEndUs) throw new Error('Line beginUs exceeds its parent timing');
    if (line.sourceTiming.parentEndUs !== null && nextEnd !== null && nextEnd > line.sourceTiming.parentEndUs) throw new Error('Line endUs exceeds its parent timing');
    if (changedText) {
      line.inline = [{ kind: 'text', text: update.changes.text!, editable: true }];
    }
    if ((changedText || changedBegin || changedEnd) && workflow?.lineReviews?.[line.id]?.status === 'confirmed') workflow.lineReviews[line.id] = { status: 'needs-review' };
    Object.assign(line, update.changes);
  }
  return { document, workflow };
}

function applyRubyUpdate(snapshot: EditorSnapshot, lineId: string, ruby: StudioRuby[], review?: 'confirmed' | 'needs-review'): EditorSnapshot {
  const document = clone(snapshot.document);
  const workflow = clone(snapshot.workflow) ?? {};
  if (document.profile.category === 'read-only') throw new Error('Document is read-only');
  const line = document.lines.find((item) => item.id === lineId);
  if (!line) throw new Error(`Line not found: ${lineId}`);
  if (!line.editable.text) throw new Error('Ruby is read-only for this line');
  validateRubySpans(line.text, ruby);
  if (same(line.ruby, ruby) && !review) return snapshot;
  const oldById = new Map(line.ruby.map((span) => [span.id, span]));
  const nextById = new Map(ruby.map((span) => [span.id, span]));
  const sidecar = workflow.rubyReviews ?? {};
  workflow.rubyReviews = sidecar;
  for (const old of line.ruby) {
    const next = nextById.get(old.id);
    if (!next) delete sidecar[old.id];
    else if (!same(old, next)) sidecar[old.id] = { status: 'needs-review' };
  }
  for (const next of ruby) if (!oldById.has(next.id)) sidecar[next.id] = { status: review ?? 'needs-review' };
  if (review) for (const next of ruby) sidecar[next.id] = { status: review };
  line.ruby = clone(ruby);
  if (workflow.lineReviews?.[line.id] && !same(line.baseline.ruby, ruby)) workflow.lineReviews[line.id] = { status: 'needs-review' };
  return { document, workflow };
}

export function executeCommand(state: EditorState, command: EditCommand): EditorState {
  if (command.type === 'replace-document') {
    if (command.document.schemaVersion !== state.present.document.schemaVersion) throw new Error('Document schema version mismatch');
    const next: EditorSnapshot = { document: clone(command.document), workflow: clone(command.workflow) };
    if (same(next, state.present)) return state;
    return { present: next, past: [...state.past.slice(-(MAX_HISTORY - 1)), clone(state.present)], future: [] };
  }
  if (command.type === 'update-agents') {
    const document = clone(state.present.document);
    const ids = command.agents.map((agent) => agent.id);
    if (new Set(ids).size !== ids.length || ids.some((id) => !id)) throw new Error('Agent ids must be unique');
    const nextIds = new Set(ids);
    for (const agent of command.agents) {
      const previous = document.agents.find((item) => item.id === agent.id);
      if (!previous && (agent.actorRef || agent.groupRefs.length)) throw new Error('S4 agent editing does not support actor or group references');
    }
    for (const previous of document.agents) {
      const next = command.agents.find((agent) => agent.id === previous.id);
      if (next && (next.actorRef !== previous.actorRef || JSON.stringify(next.groupRefs) !== JSON.stringify(previous.groupRefs))) throw new Error('S4 agent editing cannot change actor or group references');
    }
    for (const line of document.lines) {
      for (const id of line.agentRefs) if (!nextIds.has(id)) throw new Error('Cannot delete an agent still assigned to a line');
    }
    if (JSON.stringify(document.agents) === JSON.stringify(command.agents)) return state;
    document.agents = clone(command.agents);
    const next: EditorSnapshot = { document, workflow: clone(state.present.workflow) };
    return { present: next, past: [...state.past.slice(-(MAX_HISTORY - 1)), clone(state.present)], future: [] };
  }
  if (command.type === 'update-ruby') {
    const next = applyRubyUpdate(state.present, command.lineId, command.ruby, command.review);
    if (same(next, state.present)) return state;
    return { present: next, past: [...state.past.slice(-(MAX_HISTORY - 1)), clone(state.present)], future: [] };
  }
  const updates = command.type === 'update-line' ? [{ lineId: command.lineId, changes: command.changes }] : command.updates;
  if (updates.length === 0) return state;
  const next = applyUpdates(state.present, updates);
  if (same(next, state.present)) return state;
  return { present: next, past: [...state.past.slice(-(MAX_HISTORY - 1)), clone(state.present)], future: [] };
}

export function undo(state: EditorState): EditorState {
  const previous = state.past.at(-1);
  if (!previous) return state;
  return { present: clone(previous), past: state.past.slice(0, -1), future: [clone(state.present), ...state.future].slice(0, MAX_HISTORY) };
}

export function redo(state: EditorState): EditorState {
  const next = state.future[0];
  if (!next) return state;
  return { present: clone(next), past: [...state.past.slice(-(MAX_HISTORY - 1)), clone(state.present)], future: state.future.slice(1) };
}

export const canUndo = (state: EditorState) => state.past.length > 0;
export const canRedo = (state: EditorState) => state.future.length > 0;
