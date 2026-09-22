import type { StudioLine, StudioLyricDocument, StudioRuby, TimingUnit } from './document';
import type { TimeUs } from './ttml';
import { mergeLineStructure, splitLineStructure } from './structure';
import { validateTimingUnitsForLine } from './timing';

const MAX_HISTORY = 20;

export type WorkflowSidecar = {
  lineReviews?: Record<string, { status: 'confirmed' | 'needs-review' }>;
  rubyReviews?: Record<string, { status: 'confirmed' | 'needs-review' }>;
  lineIdMap?: Record<string, string[]>;
};
export type StudioDocument = StudioLyricDocument;

export type LineUpdate = Partial<Pick<StudioLine, 'text' | 'beginUs' | 'endUs' | 'agentRefs'>>;
export type EditCommand =
  | { type: 'update-line'; lineId: string; changes: LineUpdate }
  | { type: 'update-lines'; updates: Array<{ lineId: string; changes: LineUpdate }> }
  | { type: 'update-ruby'; lineId: string; ruby: StudioRuby[]; review?: 'confirmed' | 'needs-review' }
  | { type: 'update-timing-units'; lineId: string; units: TimingUnit[] }
  | { type: 'shift-line'; lineId: string; deltaUs: number }
  | { type: 'set-line-boundaries'; lineId: string; beginUs?: TimeUs; endUs?: TimeUs }
  | { type: 'split-line'; lineId: string; at: number; newLineId?: string }
  | { type: 'merge-lines'; firstLineId: string; secondLineId: string }
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
    if (changedBegin || changedEnd) validateTimingUnitsForLine({ ...line, beginUs: nextBegin, endUs: nextEnd }, line.timingUnits);
    if (nextBegin !== null && nextBegin < line.sourceTiming.parentBeginUs) throw new Error('Line beginUs precedes its parent timing');
    if (nextEnd !== null && nextEnd < line.sourceTiming.parentBeginUs) throw new Error('Line endUs precedes its parent timing');
    if (line.sourceTiming.parentEndUs !== null && nextBegin !== null && nextBegin > line.sourceTiming.parentEndUs) throw new Error('Line beginUs exceeds its parent timing');
    if (line.sourceTiming.parentEndUs !== null && nextEnd !== null && nextEnd > line.sourceTiming.parentEndUs) throw new Error('Line endUs exceeds its parent timing');
    if (changedText) {
      line.inline = [{ kind: 'text', text: update.changes.text!, editable: true }];
      line.timingUnits = [];
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
  const changedRuby = new Set<string>();
  for (const old of line.ruby) { const next = nextById.get(old.id); if (!next || !same(old, next)) changedRuby.add(old.id); }
  line.timingUnits = line.timingUnits.filter(unit => !unit.rubyId || !changedRuby.has(unit.rubyId));
  for (const next of ruby) if (!oldById.has(next.id)) sidecar[next.id] = { status: review ?? 'needs-review' };
  if (review) for (const next of ruby) sidecar[next.id] = { status: review };
  line.ruby = clone(ruby);
  if (workflow.lineReviews?.[line.id] && !same(line.baseline.ruby, ruby)) workflow.lineReviews[line.id] = { status: 'needs-review' };
  return { document, workflow };
}

function fineTiming(snapshot: EditorSnapshot, lineId: string, units: TimingUnit[]): EditorSnapshot {
  const line = snapshot.document.lines.find(item => item.id === lineId);
  if (!line) throw new Error(`Line not found: ${lineId}`);
  if (!line.editable.timing) throw new Error('Line timing is read-only');
  validateTimingUnitsForLine(line, units);
  if (same(line.timingUnits, units)) return snapshot;
  const document = { ...snapshot.document, lines: snapshot.document.lines.map(item => item.id === lineId ? { ...item, timingUnits: clone(units) } : item) };
  const workflow = snapshot.workflow ? clone(snapshot.workflow) : snapshot.workflow;
  if (workflow?.lineReviews?.[line.id]) workflow.lineReviews[line.id] = { status: 'needs-review' };
  return { document, workflow };
}

function transaction(state: EditorState, next: EditorSnapshot): EditorState {
  if (same(next, state.present)) return state;
  return { present: next, past: [...state.past.slice(-(MAX_HISTORY - 1)), clone(state.present)], future: [] };
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
      if (agent.actorRef && !nextIds.has(agent.actorRef)) throw new Error('Agent actor reference is dangling');
      if (agent.groupRefs.some(id => !nextIds.has(id))) throw new Error('Agent group reference is dangling');
      if (agent.groupRefs.includes(agent.id) || agent.actorRef === agent.id) throw new Error('Agent group cannot reference itself');
    }
    const graph = new Map(command.agents.map(agent => [agent.id, [agent.actorRef, ...agent.groupRefs].filter((id): id is string => Boolean(id))]));
    const visit = (id: string, seen: Set<string>): boolean => { if (seen.has(id)) return true; const next = new Set(seen); next.add(id); return (graph.get(id) ?? []).some(child => visit(child, next)); };
    if (command.agents.some(agent => visit(agent.id, new Set()))) throw new Error('Agent group cannot contain cycles');
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
  if (command.type === 'update-timing-units') {
    const next = fineTiming(state.present, command.lineId, command.units);
    if (next === state.present) return state;
    return { present: next, past: [...state.past.slice(-(MAX_HISTORY - 1)), state.present], future: [] };
  }
  if (command.type === 'shift-line' || command.type === 'set-line-boundaries') {
    const line = state.present.document.lines.find(item => item.id === command.lineId);
    if (!line) throw new Error(`Line not found: ${command.lineId}`);
    const delta = command.type === 'shift-line' ? command.deltaUs : 0;
    if (command.type === 'shift-line' && (!Number.isSafeInteger(delta) || (line.beginUs !== null && line.beginUs + delta < 0) || (line.endUs !== null && line.endUs + delta < 0))) throw new Error('Invalid line shift');
    if (command.type === 'shift-line') {
      const shiftedInput = clone(state.present), shiftedInputLine = shiftedInput.document.lines.find(item => item.id === line.id)!;
      shiftedInputLine.timingUnits = shiftedInputLine.timingUnits.map(unit => ({ ...unit, beginUs: unit.beginUs === null ? null : unit.beginUs + delta, endUs: unit.endUs === null ? null : unit.endUs + delta }));
      const next = applyUpdates(shiftedInput, [{ lineId: command.lineId, changes: { beginUs: line.beginUs === null ? null : line.beginUs + delta, endUs: line.endUs === null ? null : line.endUs + delta } }]);
      return transaction(state, next);
    }
    return transaction(state, applyUpdates(state.present, [{ lineId: command.lineId, changes: { ...(Object.prototype.hasOwnProperty.call(command, 'beginUs') ? { beginUs: command.beginUs } : {}), ...(Object.prototype.hasOwnProperty.call(command, 'endUs') ? { endUs: command.endUs } : {}) } }]));
  }
  if (command.type === 'split-line') {
    const document = clone(state.present.document), line = document.lines.find(item => item.id === command.lineId);
    if (!line) throw new Error(`Line not found: ${command.lineId}`);
    const points = Array.from(line.text); if (!Number.isSafeInteger(command.at) || command.at <= 0 || command.at >= points.length) throw new Error('Split position must be inside line text');
    const secondId = command.newLineId ?? `${line.id}-split`; if (document.lines.some(item => item.id === secondId)) throw new Error('New line id already exists');
    const [first, second] = splitLineStructure(line, command.at, secondId);
    document.lines.splice(document.lines.indexOf(line), 1, first, second);
    const workflow = clone(state.present.workflow) ?? {}; workflow.lineIdMap = { ...workflow.lineIdMap, [line.id]: [line.id, second.id] };
    if (workflow.lineReviews?.[line.id]) workflow.lineReviews[line.id] = { status: 'needs-review' };
    if (workflow.lineReviews) workflow.lineReviews[second.id] = { status: 'needs-review' };
    return transaction(state, { document, workflow });
  }
  if (command.type === 'merge-lines') {
    const document = clone(state.present.document), first = document.lines.find(item => item.id === command.firstLineId), second = document.lines.find(item => item.id === command.secondLineId);
    if (!first || !second) throw new Error('Line not found');
    if (first.id === second.id || first.parentPath.join('.') !== second.parentPath.join('.') || document.lines.indexOf(second) !== document.lines.indexOf(first) + 1 || JSON.stringify(first.agentRefs) !== JSON.stringify(second.agentRefs)) throw new Error('Only adjacent lines with the same parent and agent can merge');
    if (!first.editable.text || !second.editable.text) throw new Error('Merge requires editable lines');
    if (first.endUs !== null && second.beginUs !== null && first.endUs > second.beginUs) throw new Error('Cannot merge overlapping line timing');
    const merged = mergeLineStructure(first, second); document.lines.splice(document.lines.indexOf(first), 2, merged);
    const workflow = clone(state.present.workflow) ?? {}; workflow.lineIdMap = { ...workflow.lineIdMap, [first.id]: [first.id], [second.id]: [first.id] };
    if (workflow.lineReviews?.[first.id]) workflow.lineReviews[first.id] = { status: 'needs-review' };
    delete workflow.lineReviews?.[second.id];
    return transaction(state, { document, workflow });
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
