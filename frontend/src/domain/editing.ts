import type { StudioLine, StudioLyricDocument } from './document';
import type { TimeUs } from './ttml';

const MAX_HISTORY = 20;

export type WorkflowSidecar = {
  lineReviews?: Record<string, { status: 'confirmed' | 'needs-review' }>;
};
export type StudioDocument = StudioLyricDocument;

export type LineUpdate = Partial<Pick<StudioLine, 'text' | 'beginUs' | 'endUs'>>;
export type EditCommand =
  | { type: 'update-line'; lineId: string; changes: LineUpdate }
  | { type: 'update-lines'; updates: Array<{ lineId: string; changes: LineUpdate }> };

export type EditorSnapshot = { document: StudioDocument; workflow?: WorkflowSidecar };
export type EditorState = {
  present: EditorSnapshot;
  past: EditorSnapshot[];
  future: EditorSnapshot[];
};

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
  if (keys.some((key) => !['text', 'beginUs', 'endUs'].includes(key))) throw new Error('Unsupported line field');
  if ('text' in changes && typeof changes.text !== 'string') throw new Error('Line text must be a string');
  if ('beginUs' in changes && !validTime(changes.beginUs)) throw new Error('beginUs must be a non-negative integer or null');
  if ('endUs' in changes && !validTime(changes.endUs)) throw new Error('endUs must be a non-negative integer or null');
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
    if (!changedText && !changedBegin && !changedEnd) continue;
    if (changedText && !line.editable.text) throw new Error('Lines with Ruby or structured text are read-only');
    if ((changedBegin || changedEnd) && !line.editable.timing) throw new Error('Line timing is read-only');
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

export function executeCommand(state: EditorState, command: EditCommand): EditorState {
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
