import type { LyricDocument } from '../../domain/lyric-document';
import type { EditorSelection } from './editing-actions';

type Node = { selection: EditorSelection; parent?: string; siblings: string[]; main?: boolean };
function objects(document: LyricDocument) {
  const nodes = new Map<string, Node>();
  const add = (selection: EditorSelection, siblings: string[], parent?: string, main = false) => nodes.set(selection.activeId, { selection, siblings, parent, main });
  const single = (id: string) => ({ ids: [id], activeId: id, anchorId: id });
  for (const line of document.lines) {
    add({ kind: 'lines', ...single(line.id) }, document.lines.filter(item => item.backgroundOf === line.backgroundOf).map(item => item.id), line.backgroundOf ?? undefined, !line.backgroundOf);
    for (const word of line.words) {
      add({ kind: 'words', lineId: line.id, ...single(word.id) }, line.words.map(item => item.id), line.id);
      for (const ruby of word.rubyUnits) add({ kind: 'ruby', lineId: line.id, wordId: word.id, ...single(ruby.id) }, word.rubyUnits.map(item => item.id), word.id);
    }
  }
  for (const key of ['romanizationTracks', 'translationTracks'] as const) for (const track of document[key]) for (const content of track.contents) {
    const common = { lineId: content.lineId, trackId: track.id, contentId: content.id, ...(key === 'translationTracks' ? { attachment: 'translation' as const } : {}) };
    add({ kind: 'romanization-content', ...common, ...single(content.id) }, track.contents.filter(item => item.lineId === content.lineId).map(item => item.id), content.lineId);
    if (content.kind === 'timed') for (const unit of content.units) add({ kind: 'romanization-unit', ...common, ...single(unit.id) }, content.units.map(item => item.id), content.id);
  }
  return nodes;
}
const sameKind = (a: EditorSelection, b: EditorSelection) => a.kind === b.kind && (!('attachment' in a) && !('attachment' in b) || ('attachment' in a ? a.attachment : undefined) === ('attachment' in b ? b.attachment : undefined));

/** Use original sibling order and ownership, then resolve only objects that actually survived. */
export function recoverSelection(before: LyricDocument, after: LyricDocument, selection: EditorSelection): EditorSelection | null {
  const old = objects(before), next = objects(after);
  const reference = old.get(selection.activeId)?.selection;
  const id = reference && sameKind(reference, selection) ? selection.activeId : [...old].find(([id, node]) => selection.ids.includes(id) && sameKind(node.selection, selection))?.[0];
  const resolve = (id: string | undefined): EditorSelection | null => {
    if (!id) return null;
    const surviving = next.get(id);
    if (surviving) return surviving.selection;
    const node = old.get(id);
    if (!node) return null;
    const index = node.siblings.indexOf(id);
    const previous = node.siblings.slice(0, index).reverse().find(sibling => next.has(sibling));
    if (previous) return next.get(previous)!.selection;
    if (node.parent) return resolve(node.parent);
    const following = node.main && node.siblings.slice(index + 1).find(sibling => next.has(sibling));
    return following ? next.get(following)!.selection : null;
  };
  return resolve(id);
}

/** Reconcile history/other mutations without inventing a separate focus history. */
export function survivingSelection(before: LyricDocument, after: LyricDocument, selection: EditorSelection): EditorSelection | null {
  const next = objects(after);
  const ids = selection.ids.filter(id => { const node = next.get(id); return node && sameKind(node.selection, selection); });
  if (!ids.length) return selection.ids.length ? recoverSelection(before, after, selection) : selection;
  const activeId = ids.includes(selection.activeId) ? selection.activeId : ids[0];
  return { ...next.get(activeId)!.selection, ids, activeId, anchorId: ids.includes(selection.anchorId) ? selection.anchorId : activeId };
}

const objectAttribute = (selection: EditorSelection) => selection.kind === 'lines' ? 'data-line-id' : selection.kind === 'words' ? 'data-word-id' : selection.kind === 'ruby' ? 'data-ruby-id'
  : selection.kind === 'romanization-content' ? selection.attachment ? 'data-translation-id' : 'data-romanization-content-id' : selection.attachment ? 'data-translation-unit-id' : 'data-romanization-unit-id';
export function selectionSelector(selection: EditorSelection) {
  return `[${objectAttribute(selection)}="${CSS.escape(selection.activeId)}"]`;
}

/** Focus acknowledges an existing selected object; only a user click replaces a group. */
export function preserveSelectionOnFocus(selection: EditorSelection | null, target: Element) {
  if (target.closest('[data-selection-focus]')) return true;
  if (!selection) return false;
  const object = target.closest('[data-ruby-id], [data-translation-unit-id], [data-romanization-unit-id], [data-translation-id], [data-romanization-content-id], [data-word-id], [data-line-id]');
  return !!object && selection.ids.includes(object.getAttribute(objectAttribute(selection)) ?? '');
}

export function focusObject(node: HTMLElement) {
  node.setAttribute('data-selection-focus', '');
  node.focus({ preventScroll: true });
  node.removeAttribute('data-selection-focus');
}
