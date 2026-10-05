import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { createLyricEditorState, executeLyricCommand, type LyricCommand } from '../../domain/lyric-commands';
import type { LyricDocument } from '../../domain/lyric-document';
import { copySelection, moveWordsAcrossLine, pasteRich, type EditorSelection } from './editing-actions';
import styles from './semantic-editor.module.css';

export type DragSource = { kind: 'line'; lineId: string } | { kind: 'word'; lineId: string; wordId: string }
  | { kind: 'ruby'; lineId: string; wordId: string; rubyId: string; rubyIds?: string[] }
  | { kind: 'romanization-content'; lineId: string; trackId: string; contentId: string }
  | { kind: 'romanization-unit'; lineId: string; trackId: string; contentId: string; unitId: string };
export type DragSlot = { lineId: string; wordId?: string; afterId: string | null };
const attribute = (source: DragSource) => source.kind === 'line' ? 'data-line-id' : source.kind === 'word' ? 'data-word-id' : source.kind === 'ruby' ? 'data-ruby-id' : source.kind === 'romanization-content' ? 'data-romanization-content-id' : 'data-romanization-unit-id';
const sourceId = (source: DragSource) => source.kind === 'line' ? source.lineId : source.kind === 'word' ? source.wordId : source.kind === 'ruby' ? source.rubyId : source.kind === 'romanization-content' ? source.contentId : source.unitId;
export function dragSelection(source: DragSource): EditorSelection {
  const id = sourceId(source), common = { ids: source.kind === 'ruby' ? source.rubyIds ?? [id] : [id], anchorId: id, activeId: id };
  if (source.kind === 'line') return { kind: 'lines', ...common };
  if (source.kind === 'word') return { kind: 'words', lineId: source.lineId, ...common };
  return { ...source, ...common };
}

/** One explicit predecessor is used both for the transient layout and the committed command. */
export function dragCommand(document: LyricDocument, source: DragSource, slot: DragSlot, copy: boolean): { command: LyricCommand; selection: EditorSelection } {
  const selection = dragSelection(source);
  if (copy && (source.kind === 'line' || source.kind === 'word')) {
    const target: EditorSelection = source.kind === 'line'
      ? { kind: 'lines', ids: [], anchorId: '', activeId: slot.afterId ?? '' }
      : { kind: 'words', lineId: slot.lineId, ids: [], anchorId: '', activeId: slot.afterId ?? '' };
    const result = pasteRich(document, copySelection(document, selection), target);
    if (result.command.type === 'batch') {
      const first = result.command.commands.find(command => command.type === (source.kind === 'line' ? 'insert-line' : 'insert-word'));
      if (first?.type === 'insert-line') first.afterLineId = slot.afterId;
      if (first?.type === 'insert-word') first.afterWordId = slot.afterId;
    }
    return result;
  }
  switch (source.kind) {
    case 'line': return { command: { type: 'move-line', lineId: source.lineId, afterLineId: slot.afterId }, selection };
    case 'word': return { command: source.lineId === slot.lineId ? { type: 'move-word', lineId: source.lineId, wordId: source.wordId, toLineId: slot.lineId, afterWordId: slot.afterId } : moveWordsAcrossLine(document, selection as Extract<EditorSelection, { kind: 'words' }>, slot.lineId, slot.afterId), selection: { ...selection, lineId: slot.lineId } as EditorSelection };
    case 'ruby': {
      if (slot.lineId !== source.lineId) throw new Error('读音不能跨歌词行移动');
      const wordId = slot.wordId ?? source.wordId;
      return { command: { type: 'move-ruby', lineId: source.lineId, wordId: source.wordId, toWordId: wordId, rubyId: source.rubyId, rubyIds: source.rubyIds, afterRubyId: slot.afterId }, selection: { ...selection, wordId } as EditorSelection };
    }
    case 'romanization-content': return { command: { type: 'move-romanization-content', trackId: source.trackId, contentId: source.contentId, lineId: source.lineId, afterContentId: slot.afterId }, selection };
    case 'romanization-unit': return { command: { type: 'move-romanization-unit', trackId: source.trackId, contentId: source.contentId, unitId: source.unitId, afterUnitId: slot.afterId }, selection };
  }
}

type Preview = { kind: DragSource['kind']; document: LyricDocument; command: LyricCommand; selection: EditorSelection; placeholders: Set<string> };
type Session = { source: DragSource; id: number; originX: number; originY: number; x: number; y: number; copy: boolean; started: boolean;
  ghost: HTMLElement | null; node: HTMLElement; offsetX: number; offsetY: number; key: string; preview: Preview | null; frame: number; lastPoint: string; slot: DragSlot | null; appliedCopy: boolean };
const objectSelector = '[data-line-id], [data-word-id], [data-ruby-id], [data-romanization-content-id], [data-romanization-unit-id]';

function visibleOutlineRows(panel: HTMLElement): HTMLElement[] {
  if (!panel.firstElementChild) return [];
  const height = panel.firstElementChild.getBoundingClientRect().height;
  const first = Math.max(0, Math.floor(panel.scrollTop / height) - 1);
  const last = Math.min(panel.children.length, Math.ceil((panel.scrollTop + panel.clientHeight) / height) + 1);
  return Array.from({ length: last - first }, (_, index) => panel.children[first + index] as HTMLElement);
}

export function useObjectDrag(document: LyricDocument, root: RefObject<HTMLDivElement | null>, apply: (command: LyricCommand) => boolean, select: (selection: EditorSelection) => void) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const session = useRef<Session | null>(null);
  const animations = useRef<Animation[]>([]);
  const oldRects = useRef(new Map<HTMLElement, DOMRect>());
  const suppressClick = useRef(false);
  const sizedWords = useRef<HTMLElement[]>([]);
  const latest = useRef({ document, apply, select }); latest.current = { document, apply, select };
  const captureRects = () => {
    oldRects.current.clear();
    animations.current.forEach(animation => animation.cancel()); animations.current = [];
    // Canvas is virtualized. Outline rows have a fixed height; measure its visible slice only.
    const source = session.current?.source;
    const nodes = [...(root.current?.querySelectorAll<HTMLElement>(`main ${source?.kind === 'line' ? '[data-line-id]' : objectSelector.split(', ').join(', main ')}`) ?? [])];
    if (source?.kind === 'line') {
      const panel = root.current?.querySelector<HTMLElement>(`.${styles.outline} .${styles.panelBody}`);
      if (panel) nodes.push(...visibleOutlineRows(panel));
    }
    for (const node of nodes) {
      const rect = node.getBoundingClientRect();
      if (rect.bottom >= 0 && rect.top <= window.innerHeight) oldRects.current.set(node, rect);
    }
  };
  useLayoutEffect(() => {
    const current = session.current;
    if (oldRects.current.size && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) for (const [node, before] of oldRects.current) {
      if (!node.isConnected || node.closest('[data-drag-placeholder]')) continue;
      const after = node.getBoundingClientRect(), x = before.left - after.left, y = before.top - after.top;
      if ((x || y) && !node.parentElement?.closest(objectSelector)) animations.current.push(node.animate([{ translate: `${x}px ${y}px` }, { translate: '0 0' }], { duration: 130, easing: 'ease-out' }));
      else if ((x || y) && current?.source.kind !== 'line' && node.matches(`[${attribute(current!.source)}]`)) animations.current.push(node.animate([{ translate: `${x}px ${y}px` }, { translate: '0 0' }], { duration: 130, easing: 'ease-out' }));
    }
    oldRects.current.clear();
  }, [preview, root]);
  const cleanup = () => {
    const current = session.current; session.current = null;
    animations.current.forEach(animation => animation.cancel()); animations.current = [];
    oldRects.current.clear();
    for (const node of sizedWords.current) {
      delete node.dataset.rubyDragSize;
      node.style.removeProperty('--ruby-drag-width'); node.style.removeProperty('--ruby-drag-height');
    }
    sizedWords.current = [];
    if (current) { cancelAnimationFrame(current.frame); current.ghost?.remove(); }
    root.current?.removeAttribute('data-object-drag');
    if (current && root.current?.hasPointerCapture(current.id)) root.current.releasePointerCapture(current.id);
  };
  const cancel = () => { cleanup(); setPreview(null); };
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && session.current) { event.preventDefault(); event.stopPropagation(); cancel(); } };
    window.addEventListener('keydown', escape, true);
    return () => window.removeEventListener('keydown', escape, true);
  }, []);
  useEffect(() => { cancel(); }, [document]);
  useEffect(() => () => cleanup(), []);

  const resolve = (current: Session): DragSlot | 'hold' | null => {
    const element = window.document.elementFromPoint(current.x, current.y);
    if (!element || !root.current?.contains(element)) return null;
    if (element.closest('[data-drag-placeholder]')) return 'hold';
    const source = current.source, shown = current.preview?.document ?? latest.current.document;
    const lineNode = element.closest<HTMLElement>('[data-line-id]');
    const line = shown.lines.find(line => line.id === lineNode?.dataset.lineId);
    let nodes: HTMLElement[], ids: string[], container: HTMLElement | null;
    let lineId = line?.id ?? source.lineId;
    let wordId: string | undefined;
    if (source.kind === 'line') {
      container = element.closest<HTMLElement>(`[aria-label="歌词列表"], .${styles.outline} .${styles.panelBody}`);
      if (!container) return null;
      ids = shown.lines.filter(line => !line.backgroundOf).map(line => line.id);
      const mainIds = new Set(ids);
      nodes = (container.closest(`.${styles.outline}`) ? visibleOutlineRows(container) : [...container.querySelectorAll<HTMLElement>('[data-line-id]')])
        .filter(node => mainIds.has(node.dataset.lineId!));
    } else if (source.kind === 'word') {
      if (!line || !lineNode) return null;
      if (lineNode.closest(`.${styles.outline}`)) return { lineId: line.id, afterId: line.words.filter(word => current.copy || word.id !== source.wordId).at(-1)?.id ?? null };
      if (!lineNode.closest('[aria-label="歌词列表"]')) return null;
      container = lineNode.querySelector<HTMLElement>(`.${styles.words}`);
      ids = line.words.map(word => word.id);
      nodes = [...container!.querySelectorAll<HTMLElement>('[data-word-id]')];
    } else {
      if (lineId !== source.lineId || !lineNode) return null;
      if (source.kind === 'ruby') {
        container = element.closest<HTMLElement>('[data-word-id]');
        if (!container || !line) return null;
        wordId = container.dataset.wordId;
        ids = line.words.find(word => word.id === wordId)!.rubyUnits.map(unit => unit.id);
      } else {
        const track = shown.romanizationTracks.find(track => track.id === source.trackId)!;
        if (source.kind === 'romanization-content') {
          const content = element.closest<HTMLElement>('[data-romanization-content-id]');
          if (!track.contents.some(item => item.id === content?.dataset.romanizationContentId)) return null;
          container = content!.parentElement;
          ids = track.contents.filter(item => item.lineId === source.lineId).map(item => item.id);
        } else {
          container = element.closest<HTMLElement>('[data-romanization-content-id]');
          if (container?.dataset.romanizationContentId !== source.contentId) return null;
          const content = track.contents.find(item => item.id === source.contentId)!;
          ids = content.kind === 'timed' ? content.units.map(unit => unit.id) : [];
        }
      }
      nodes = [...container!.querySelectorAll<HTMLElement>(`[${attribute(source)}]`)];
    }
    const excluded = current.copy && (source.kind === 'line' || source.kind === 'word') ? new Set<string>() : new Set(source.kind === 'ruby' ? source.rubyIds ?? [source.rubyId] : [sourceId(source)]);
    current.preview?.placeholders.forEach(id => excluded.add(id));
    ids = ids.filter(id => !excluded.has(id));
    const allowedIds = new Set(ids);
    nodes = nodes.filter(node => allowedIds.has(node.getAttribute(attribute(source))!));
    if (!nodes.length) return { lineId, wordId, afterId: null };
    // Nearest rectangle in both axes handles wrapped words/注音 instead of assuming one horizontal row.
    const vertical = source.kind === 'line' || source.kind === 'romanization-content';
    const ranked = nodes.map(node => {
      // Read layout, not an in-flight FLIP animation's visual position.
      const rect = node.getBoundingClientRect();
      for (let ancestor: HTMLElement | null = node; ancestor && ancestor !== root.current; ancestor = ancestor.parentElement) {
        if (!ancestor.getAnimations().length) continue;
        const [x, y = '0'] = getComputedStyle(ancestor).translate.split(' ');
        if (x !== 'none') { rect.x -= parseFloat(x); rect.y -= parseFloat(y); }
      }
      const dx = Math.max(rect.left - current.x, 0, current.x - rect.right), dy = Math.max(rect.top - current.y, 0, current.y - rect.bottom);
      return { node, rect, distance: vertical ? dy : dx * dx + dy * dy };
    }).sort((a, b) => a.distance - b.distance);
    const { node, rect } = ranked[0];
    const id = node.getAttribute(attribute(source))!;
    const before = vertical ? current.y < rect.top + rect.height / 2 : current.y < rect.top || current.y <= rect.bottom && current.x < rect.left + rect.width / 2;
    if (source.kind === 'line') lineId = id;
    return { lineId, wordId, afterId: before ? ids[ids.indexOf(id) - 1] ?? null : id };
  };
  const tick = () => {
    const current = session.current; if (!current?.started) return;
    current.ghost!.style.transform = `translate(${current.x - current.offsetX}px, ${current.y - current.offsetY}px)`;
    const element = window.document.elementFromPoint(current.x, current.y);
    const scroller = element?.closest<HTMLElement>(`[aria-label="歌词列表"], .${styles.panelBody}`);
    if (scroller) {
      const rect = scroller.getBoundingClientRect();
      const delta = current.y < rect.top + 36 ? -12 : current.y > rect.bottom - 36 ? 12 : 0;
      if (delta) scroller.scrollTop += delta;
    }
    const point = `${current.x}:${current.y}:${current.copy}:${scroller?.scrollTop}`;
    if (point === current.lastPoint) { current.frame = requestAnimationFrame(tick); return; }
    current.lastPoint = point;
    const resolved = resolve(current);
    const slot = resolved === 'hold' && current.copy !== current.appliedCopy ? current.slot : resolved;
    if (slot !== 'hold') {
      const key = slot ? `${slot.lineId}:${slot.wordId}:${slot.afterId}:${current.copy}` : '';
      if (key !== current.key) {
        current.key = key; current.slot = slot; current.appliedCopy = current.copy;
        delete current.ghost!.dataset.dropError;
        let next: Preview | null = null;
        if (slot) {
          try {
            const result = dragCommand(latest.current.document, current.source, slot, current.copy);
            const projected = executeLyricCommand(createLyricEditorState(latest.current.document), result.command).present;
            if (projected !== latest.current.document) next = { ...result, kind: current.source.kind, document: projected, placeholders: new Set(result.selection.ids) };
          } catch (cause) {
            current.ghost!.dataset.dropError = cause instanceof Error ? cause.message : '此处无法放置';
          }
        }
        captureRects(); current.preview = next; setPreview(next);
      }
    }
    current.frame = requestAnimationFrame(tick);
  };
  const start = (source: DragSource, node: HTMLElement, pointerId: number, x: number, y: number, copy: boolean) => {
    cleanup();
    const rect = node.getBoundingClientRect();
    session.current = { source, node, id: pointerId, originX: x, originY: y, x, y, copy, started: false, ghost: null, offsetX: x - rect.left, offsetY: y - rect.top, key: '', preview: null, frame: 0, lastPoint: '', slot: null, appliedCopy: copy };
    suppressClick.current = true;
    root.current!.dataset.objectDrag = '';
    root.current!.setPointerCapture(pointerId);
  };
  const move = (pointerId: number, x: number, y: number, copy: boolean) => {
    const current = session.current; if (!current || current.id !== pointerId) return;
    current.x = x; current.y = y; current.copy = copy;
    if (!current.started && Math.hypot(x - current.originX, y - current.originY) >= 4) {
      current.started = true;
      if (current.source.kind === 'ruby') {
        // Keep words under the pointer while the preview changes Ruby ownership.
        const line = current.node.closest('[data-line-id]');
        const boxes = [...(line?.querySelectorAll<HTMLElement>('[data-word-id]') ?? [])].map(node => ({ node, rect: node.getBoundingClientRect() }));
        sizedWords.current = boxes.map(({ node, rect }) => {
          node.dataset.rubyDragSize = '';
          node.style.setProperty('--ruby-drag-width', `${rect.width}px`);
          node.style.setProperty('--ruby-drag-height', `${rect.height}px`);
          return node;
        });
      }
      const ghost = current.node.cloneNode(true) as HTMLElement;
      ghost.removeAttribute('id'); ghost.querySelectorAll('[id]').forEach(node => node.removeAttribute('id'));
      ghost.classList.add(styles.dragGhost); ghost.setAttribute('aria-hidden', 'true'); ghost.inert = true;
      ghost.style.width = `${current.node.getBoundingClientRect().width}px`;
      window.document.body.append(ghost); current.ghost = ghost;
      root.current!.setPointerCapture(pointerId);
      window.getSelection()?.removeAllRanges();
      tick();
    }
  };
  const finish = () => {
    const current = session.current;
    if (current?.started) { cancelAnimationFrame(current.frame); tick(); }
    const result = current?.preview;
    cleanup(); setPreview(null);
    if (result && latest.current.apply(result.command)) {
      latest.current.select(result.selection);
      if (result.selection.kind === 'ruby') {
        const id = result.selection.activeId;
        requestAnimationFrame(() => root.current?.querySelector<HTMLElement>(`[data-ruby-id="${CSS.escape(id)}"]`)?.focus({ preventScroll: true }));
      }
    }
    window.setTimeout(() => { suppressClick.current = false; }, 0);
  };
  return { document: preview?.document ?? document, placeholders: preview ? { kind: preview.kind, ids: preview.placeholders } : null,
    isPlaceholder: (kind: DragSource['kind'], id: string) => preview?.kind === kind && preview.placeholders.has(id), start, move, finish, cancel, active: () => Boolean(session.current), suppressClick };
}
