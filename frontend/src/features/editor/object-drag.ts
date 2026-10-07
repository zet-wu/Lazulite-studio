import { createProjectEditing } from '../../domain/project-editing';
import { useProjectEditing } from './ProjectEditingContext';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { applyLyricCommand, type LyricCommand } from '../../domain/lyric-commands';
import type { LyricDocument } from '../../domain/lyric-document';
import { copySelection, moveWordsAcrossLine, pasteRich, type EditorSelection } from './editing-actions';
import styles from './semantic-editor.module.css';

export type DragSource = { kind: 'line'; lineId: string; lineIds?: string[] } | { kind: 'word'; lineId: string; wordId: string; wordIds?: string[] }
  | { kind: 'ruby'; lineId: string; wordId: string; rubyId: string; rubyIds?: string[] }
  | { kind: 'romanization-content'; lineId: string; trackId: string; contentId: string }
  | { kind: 'romanization-unit'; lineId: string; trackId: string; contentId: string; unitId: string };
export type DragSlot = { lineId: string; wordId?: string; afterId: string | null };
const attribute = (source: DragSource) => source.kind === 'line' ? 'data-line-id' : source.kind === 'word' ? 'data-word-id' : source.kind === 'ruby' ? 'data-ruby-id' : source.kind === 'romanization-content' ? 'data-romanization-content-id' : 'data-romanization-unit-id';
const sourceId = (source: DragSource) => source.kind === 'line' ? source.lineId : source.kind === 'word' ? source.wordId : source.kind === 'ruby' ? source.rubyId : source.kind === 'romanization-content' ? source.contentId : source.unitId;
export function dragSelection(source: DragSource): EditorSelection {
  const id = sourceId(source), common = { ids: source.kind === 'ruby' ? source.rubyIds ?? [id] : source.kind === 'word' ? source.wordIds ?? [id] : source.kind === 'line' ? source.lineIds ?? [id] : [id], anchorId: id, activeId: id };
  if (source.kind === 'line') return { kind: 'lines', ...common };
  if (source.kind === 'word') return { kind: 'words', lineId: source.lineId, ...common };
  return { ...source, ...common };
}

/** One explicit predecessor is validated before the same command is committed. */
export function dragCommand(document: LyricDocument, source: DragSource, slot: DragSlot, copy: boolean, editing = createProjectEditing()): { command: LyricCommand; selection: EditorSelection } {
  const selection = dragSelection(source);
  if (copy && (source.kind === 'line' || source.kind === 'word')) {
    const target: EditorSelection = source.kind === 'line'
      ? { kind: 'lines', ids: [], anchorId: '', activeId: slot.afterId ?? '' }
      : { kind: 'words', lineId: slot.lineId, ids: [], anchorId: '', activeId: slot.afterId ?? '' };
    const result = pasteRich(document, copySelection(document, selection, editing), target);
    if (result.command.type === 'batch') {
      const first = result.command.commands.find(command => command.type === (source.kind === 'line' ? 'insert-line' : 'insert-word'));
      if (first?.type === 'insert-line') first.afterLineId = slot.afterId;
      if (first?.type === 'insert-word') first.afterWordId = slot.afterId;
    }
    return result;
  }
  switch (source.kind) {
    case 'line': {
      const ids = document.lines.filter(line => !line.backgroundOf && selection.ids.includes(line.id)).map(line => line.id);
      let after = slot.afterId;
      return { command: { type: 'batch', commands: ids.map(lineId => { const command: LyricCommand = { type: 'move-line', lineId, afterLineId: after }; after = lineId; return command; }) }, selection };
    }
    case 'word': {
      const selected = document.lines.flatMap(line => line.words.filter(word => selection.ids.includes(word.id)).map(word => ({ line, word })));
      let after = slot.afterId;
      // Cross-line moves expand the target envelope once, inside the same transaction.
      const incoming = selected.filter(item => item.line.id !== slot.lineId);
      const expansion = incoming.length ? moveWordsAcrossLine(document, { ...selection, kind: 'words', lineId: source.lineId, ids: incoming.map(item => item.word.id) }, slot.lineId, slot.afterId) : null;
      const commands: Extract<LyricCommand, { type: 'batch' }>['commands'] = expansion?.type === 'batch' ? expansion.commands.filter(command => command.type === 'set-line-time') : [];
      for (const { line, word } of selected) { commands.push({ type: 'move-word', lineId: line.id, wordId: word.id, toLineId: slot.lineId, afterWordId: after }); after = word.id; }
      return { command: { type: 'batch', commands }, selection: { ...selection, lineId: slot.lineId } as EditorSelection };
    }
    case 'ruby': {
      if (slot.lineId !== source.lineId) throw new Error('读音不能跨歌词行移动');
      const wordId = slot.wordId ?? source.wordId;
      return { command: { type: 'move-ruby', lineId: source.lineId, wordId: source.wordId, toWordId: wordId, rubyId: source.rubyId, rubyIds: source.rubyIds, afterRubyId: slot.afterId }, selection: { ...selection, wordId } as EditorSelection };
    }
    case 'romanization-content': return { command: { type: 'move-romanization-content', trackId: source.trackId, contentId: source.contentId, lineId: source.lineId, afterContentId: slot.afterId }, selection };
    case 'romanization-unit': return { command: { type: 'move-romanization-unit', trackId: source.trackId, contentId: source.contentId, unitId: source.unitId, afterUnitId: slot.afterId }, selection };
  }
}

type Preview = { command: LyricCommand; selection: EditorSelection };
type Marker = { x: number; y: number; width: number; height: number };
type Session = { source: DragSource; id: number; originX: number; originY: number; x: number; y: number; copy: boolean; started: boolean;
  ghost: HTMLElement | null; marker: HTMLElement | null; node: HTMLElement; offsetX: number; offsetY: number; key: string; preview: Preview | null; frame: number; slot: DragSlot | null;
  boundary: { node: HTMLElement; before: boolean } | null; edge: { node: HTMLElement; direction: number; since: number } | null; lastTime: number };

function visibleOutlineRows(panel: HTMLElement): HTMLElement[] {
  if (!panel.firstElementChild) return [];
  const height = panel.firstElementChild.getBoundingClientRect().height;
  const first = Math.max(0, Math.floor(panel.scrollTop / height) - 1);
  const last = Math.min(panel.children.length, Math.ceil((panel.scrollTop + panel.clientHeight) / height) + 1);
  return Array.from({ length: last - first }, (_, index) => panel.children[first + index] as HTMLElement);
}

export function useObjectDrag(document: LyricDocument, root: RefObject<HTMLDivElement | null>, apply: (command: LyricCommand) => boolean, select: (selection: EditorSelection) => void) {
  const editing = useProjectEditing();
  const [dragging, setDragging] = useState<DragSource | null>(null);
  const session = useRef<Session | null>(null);
  const suppressClick = useRef(false);
  const latest = useRef({ document, apply, select, editing }); latest.current = { document, apply, select, editing };
  const cleanup = () => {
    const current = session.current; session.current = null;
    if (current) { cancelAnimationFrame(current.frame); current.ghost?.remove(); current.marker?.remove(); }
    root.current?.removeAttribute('data-object-drag');
    if (current && root.current?.hasPointerCapture(current.id)) root.current.releasePointerCapture(current.id);
  };
  const cancel = () => { cleanup(); setDragging(null); };
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && session.current) { event.preventDefault(); event.stopPropagation(); cancel(); } };
    window.addEventListener('keydown', escape, true);
    return () => window.removeEventListener('keydown', escape, true);
  }, []);
  useEffect(() => { cancel(); }, [document]);
  useEffect(() => () => cleanup(), []);

  const resolve = (current: Session): { slot: DragSlot; marker: Marker } | null => {
    const element = window.document.elementFromPoint(current.x, current.y);
    if (!element || !root.current?.contains(element)) return null;
    const source = current.source, shown = latest.current.document;
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
      if (lineNode.closest(`.${styles.outline}`)) {
        const rect = lineNode.getBoundingClientRect();
        return { slot: { lineId: line.id, afterId: line.words.filter(word => current.copy || !dragSelection(source).ids.includes(word.id)).at(-1)?.id ?? null }, marker: { x: rect.left, y: rect.bottom, width: rect.width, height: 2 } };
      }
      if (!lineNode.closest('[aria-label="歌词列表"]')) return null;
      container = lineNode.querySelector<HTMLElement>(`.${styles.words}, .${styles.syncWords}`);
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
    const excluded = current.copy && (source.kind === 'line' || source.kind === 'word') ? new Set<string>() : new Set(dragSelection(source).ids);
    ids = ids.filter(id => !excluded.has(id));
    const allowedIds = new Set(ids);
    nodes = nodes.filter(node => allowedIds.has(node.getAttribute(attribute(source))!));
    if (!nodes.length) {
      const rect = container!.getBoundingClientRect();
      return { slot: { lineId, wordId, afterId: null }, marker: { x: rect.left, y: rect.top, width: 2, height: Math.max(16, rect.height) } };
    }
    // Nearest rectangle in both axes handles wrapped words/注音 instead of assuming one horizontal row.
    const vertical = source.kind === 'line' || source.kind === 'romanization-content';
    const ranked = nodes.map(node => {
      const rect = node.getBoundingClientRect();
      const dx = Math.max(rect.left - current.x, 0, current.x - rect.right), dy = Math.max(rect.top - current.y, 0, current.y - rect.bottom);
      return { node, rect, distance: vertical ? dy : dx * dx + dy * dy };
    }).sort((a, b) => a.distance - b.distance);
    const { node, rect } = ranked[0];
    const id = node.getAttribute(attribute(source))!;
    let before = vertical ? current.y < rect.top + rect.height / 2 : current.y < rect.top || current.y <= rect.bottom && current.x < rect.left + rect.width / 2;
    const previous = current.boundary;
    // Keep the last side until the pointer crosses the measured midpoint by 3px.
    if (previous?.node === node && before !== previous.before) {
      const distance = vertical ? current.y - (rect.top + rect.height / 2) : current.x - (rect.left + rect.width / 2);
      if (Math.abs(distance) < 3 && current.y >= rect.top && current.y <= rect.bottom) before = previous.before;
    }
    current.boundary = { node, before };
    if (source.kind === 'line') lineId = id;
    return { slot: { lineId, wordId, afterId: before ? ids[ids.indexOf(id) - 1] ?? null : id },
      marker: vertical ? { x: rect.left, y: before ? rect.top : rect.bottom, width: rect.width, height: 2 }
        : { x: before ? rect.left : rect.right, y: rect.top, width: 2, height: rect.height } };
  };
  const tick = (now = performance.now()) => {
    const current = session.current; if (!current?.started) return;
    current.ghost!.style.transform = `translate(${current.x - current.offsetX}px, ${current.y - current.offsetY}px)`;
    const elapsed = Math.min(50, now - current.lastTime); current.lastTime = now;
    const element = window.document.elementFromPoint(current.x, current.y);
    const scroller = element?.closest<HTMLElement>(`[aria-label="歌词列表"], .${styles.outline} .${styles.panelBody}`);
    const scrollAllowed = current.source.kind === 'line' || current.source.kind === 'word' || !scroller?.closest(`.${styles.outline}`);
    let direction = 0, strength = 0;
    if (scroller && root.current?.contains(scroller) && scrollAllowed) {
      const rect = scroller.getBoundingClientRect();
      const top = Math.max(0, rect.top), bottom = Math.min(window.innerHeight, rect.bottom);
      const band = Math.min(22, (bottom - top) / 6);
      if (current.x >= rect.left && current.x <= rect.right && current.y >= top && current.y <= bottom) {
        if (current.y < top + band) { direction = -1; strength = (top + band - current.y) / band; }
        else if (current.y > bottom - band) { direction = 1; strength = (current.y - bottom + band) / band; }
      }
    }
    if (!direction || !scroller) current.edge = null;
    else {
      if (current.edge?.node !== scroller || current.edge.direction !== direction) current.edge = { node: scroller, direction, since: now };
      if (now - current.edge.since >= 180) scroller.scrollTop += direction * 420 * strength * strength * elapsed / 1000;
    }
    // Resolve every frame: scrolling, virtual mounting and resizing all change geometry.
    const resolved = resolve(current), slot = resolved?.slot ?? null;
    const key = slot ? `${slot.lineId}:${slot.wordId}:${slot.afterId}:${current.copy}` : '';
    if (key !== current.key) {
      current.key = key; current.slot = slot; current.preview = null;
      current.ghost!.dataset.dropError = '此处无法放置';
      if (slot) {
        try {
          const result = dragCommand(latest.current.document, current.source, slot, current.copy, latest.current.editing);
          applyLyricCommand(latest.current.document, result.command, latest.current.editing);
          current.preview = result;
          delete current.ghost!.dataset.dropError;
        } catch (cause) {
          current.ghost!.dataset.dropError = cause instanceof Error ? cause.message : '此处无法放置';
        }
      }
    }
    current.marker!.hidden = !resolved || !current.preview;
    if (resolved && current.preview) {
      const mark = resolved.marker;
      Object.assign(current.marker!.style, { left: `${mark.x}px`, top: `${mark.y}px`, width: `${mark.width}px`, height: `${mark.height}px` });
    }
    current.frame = requestAnimationFrame(tick);
  };
  const start = (source: DragSource, node: HTMLElement, pointerId: number, x: number, y: number, copy: boolean) => {
    cleanup();
    const rect = node.getBoundingClientRect();
    session.current = { source, node, id: pointerId, originX: x, originY: y, x, y, copy, started: false, ghost: null, marker: null, offsetX: x - rect.left, offsetY: y - rect.top, key: 'pending', preview: null, frame: 0, slot: null, boundary: null, edge: null, lastTime: performance.now() };
    suppressClick.current = true;
    root.current!.setPointerCapture(pointerId);
  };
  const move = (pointerId: number, x: number, y: number, copy: boolean) => {
    const current = session.current; if (!current || current.id !== pointerId) return;
    current.x = x; current.y = y; current.copy = copy;
    if (!current.started && Math.hypot(x - current.originX, y - current.originY) >= 4) {
      current.started = true;
      root.current!.dataset.objectDrag = '';
      setDragging(current.source);
      const ghost = current.node.cloneNode(true) as HTMLElement;
      ghost.removeAttribute('id'); ghost.querySelectorAll('[id]').forEach(node => node.removeAttribute('id'));
      ghost.classList.add(styles.dragGhost); ghost.setAttribute('aria-hidden', 'true'); ghost.inert = true;
      ghost.style.width = `${current.node.getBoundingClientRect().width}px`;
      window.document.body.append(ghost); current.ghost = ghost;
      const marker = window.document.createElement('div'); marker.className = styles.dragInsertion; marker.setAttribute('aria-hidden', 'true');
      window.document.body.append(marker); current.marker = marker;
      root.current!.setPointerCapture(pointerId);
      window.getSelection()?.removeAllRanges();
      tick();
    }
  };
  const finish = () => {
    const current = session.current;
    if (current?.started) { cancelAnimationFrame(current.frame); tick(); }
    const result = current?.preview;
    cleanup(); setDragging(null);
    if (result && latest.current.apply(result.command)) {
      latest.current.select(result.selection);
      if (result.selection.kind === 'ruby') {
        const id = result.selection.activeId;
        requestAnimationFrame(() => root.current?.querySelector<HTMLElement>(`[data-ruby-id="${CSS.escape(id)}"]`)?.focus({ preventScroll: true }));
      }
    }
    window.setTimeout(() => { suppressClick.current = false; }, 0);
  };
  const ids = new Set(dragging ? dragSelection(dragging).ids : []);
  return { document, placeholders: dragging ? { kind: dragging.kind, ids } : null,
    isPlaceholder: (kind: DragSource['kind'], id: string) => dragging?.kind === kind && ids.has(id), start, move, finish, cancel, active: () => Boolean(session.current), suppressClick };
}
