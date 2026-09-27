import { lazy, Suspense, useEffect, useRef, useState, type DragEvent, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import type { LyricCommand } from '../../domain/lyric-commands';
import { createLine, createWord, lineText, type LyricDocument, type LyricLine, type LyricWord } from '../../domain/lyric-document';
import { utf16ToCodePoint } from '../../domain/text-boundaries';
import { copySelection, cutSelection, invertIds, moveWordsAcrossLine, pastePlain, pasteRich, selectIds, selectionLineId, type EditorClipboard, type EditorSelection } from './editing-actions';
import { LyricList } from './LyricList';
import { LyricLine as LyricLineView } from './LyricLine';
import { LyricWord as LyricWordView } from './LyricWord';
import { DraftInput, TimePair } from './EditorFields';
import { EditorMenu } from './EditorMenu';
import { EditorRibbon } from './EditorRibbon';
import { SegmentationPanel } from './SegmentationPanel';
import { BatchToolsPanel } from './BatchToolsPanel';
import { RubyWordEditor } from './RubyWordEditor';
import { RomanizationRow } from './RomanizationRow';
import { LineSplitDialog } from './LineSplitDialog';
import { SyncPanel } from './SyncPanel';
import { MetadataPanel } from './MetadataPanel';
import { SingerDialog } from './SingerDialog';
import { SettingsDialog } from './SettingsDialog';
import type { TransportHandle } from '../MediaTransport';
import type { LyricFormat } from '../../adapters/lyric-formats';
import styles from './semantic-editor.module.css';

const CLIPBOARD_MIME = 'application/x-lazulite-lyric';
const PreviewMode = lazy(() => import('./PreviewMode').then((module) => ({ default: module.PreviewMode })));

type Props = {
  title: string;
  document: LyricDocument;
  apply: (command: LyricCommand) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  dirty: boolean;
  saving?: boolean;
  error?: string | null;
  onSave: () => void;
  onOpen?: (file: File) => void;
  onNew?: () => void;
  onDraft: () => void;
  onFinal: () => void;
  onExportFormat?: (format: LyricFormat) => void;
  onPublish?: () => void;
  selectedLineId?: string | null;
  playheadLineId?: string | null;
  onSelectLine?: (id: string) => void;
  onSelectUnit?: (lineId: string, wordId: string | null, rubyId: string | null) => void;
  transport?: RefObject<TransportHandle | null>;
  embedded?: boolean;
};

type DragSource = { kind: 'line'; lineId: string } | { kind: 'word'; lineId: string; wordId: string };

function isTextInput(target: EventTarget) {
  return target instanceof Element && Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
}

export function EditorWorkspace(props: Props) {
  const { document, apply } = props;
  const [selection, setSelection] = useState<EditorSelection | null>(null);
  const [clipboard, setClipboard] = useState<EditorClipboard | null>(null);
  const clipboardToken = useRef('');
  const dragging = useRef<DragSource | null>(null);
  const touchDrag = useRef<{ source: DragSource; target: string | null } | null>(null);
  const wordInputs = useRef(new Map<string, HTMLInputElement>());
  const [simpleLayout, setSimpleLayout] = useState(false);
  const [mode, setMode] = useState<'edit' | 'sync' | 'preview' | 'auxiliary'>('edit');
  const [settingsDialog, setSettingsDialog] = useState<'metadata' | 'singers' | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [editingWordId, setEditingWordId] = useState<string | null>(null);
  const [segmentationOpen, setSegmentationOpen] = useState(false);
  const [batchToolsOpen, setBatchToolsOpen] = useState(false);
  const [rubyShortcut, setRubyShortcut] = useState<{ wordId: string; serial: number } | null>(null);
  const rubyShortcutSerial = useRef(0);
  const [rubyBaseOpen, setRubyBaseOpen] = useState(false);
  const [rubyBaseReading, setRubyBaseReading] = useState('');
  const [backgroundTargetId, setBackgroundTargetId] = useState('');
  const [splitLineId, setSplitLineId] = useState<string | null>(null);
  const [locate, setLocate] = useState<{ id: string; serial: number } | null>(null);
  const locateSerial = useRef(0);
  const requestLocate = (id: string) => setLocate({ id, serial: ++locateSerial.current });
  const pendingFocus = useRef<string | null>(null);
  useEffect(() => {
    setSelection((current) => {
      if (!current) return current;
      if (current.kind === 'lines') {
        const order = document.lines.filter((line) => !line.backgroundOf).map((line) => line.id);
        const ids = current.ids.filter((id) => order.includes(id));
        if (ids.length === current.ids.length && (current.activeId === '' || document.lines.some((line) => line.id === current.activeId))) return current;
        return { ...current, ids, anchorId: order.includes(current.anchorId) ? current.anchorId : ids[0] ?? '', activeId: document.lines.some((line) => line.id === current.activeId) ? current.activeId : ids.at(-1) ?? '' };
      }
      if (current.kind === 'romanization-content' || current.kind === 'romanization-unit') {
        const content = document.romanizationTracks.find((track) => track.id === current.trackId)?.contents.find((item) => item.id === current.contentId);
        if (!content) return null;
        if (current.kind === 'romanization-content') return current.lineId === content.lineId ? current : { ...current, lineId: content.lineId };
        if (content.kind !== 'timed') return null;
        const ids = current.ids.filter((id) => content.units.some((unit) => unit.id === id));
        return ids.length ? { ...current, lineId: content.lineId, ids, anchorId: ids.includes(current.anchorId) ? current.anchorId : ids[0], activeId: ids.includes(current.activeId) ? current.activeId : ids.at(-1)! }
          : { kind: 'romanization-content', lineId: content.lineId, trackId: current.trackId, contentId: content.id, ids: [content.id], anchorId: content.id, activeId: content.id };
      }
      const order = document.lines.flatMap((line) => line.words.map((word) => word.id));
      const ids = current.ids.filter((id) => order.includes(id));
      const activeId = order.includes(current.activeId) ? current.activeId : ids.at(-1) ?? '';
      const activeLine = document.lines.find((line) => line.words.some((word) => word.id === activeId));
      if (activeLine && ids.length === current.ids.length && current.lineId === activeLine.id && (!current.rubyId || activeLine.words.some((word) => word.rubyUnits.some((unit) => unit.id === current.rubyId)))) return current;
      return activeLine ? { ...current, lineId: activeLine.id, ids, anchorId: order.includes(current.anchorId) ? current.anchorId : ids[0] ?? '', activeId, rubyId: null }
        : { kind: 'lines', ids: [], anchorId: '', activeId: '' };
    });
  }, [document]);
  const activeLineId = selectionLineId(selection) ?? props.selectedLineId;
  const selectedLine = document.lines.find((line) => line.id === activeLineId) ?? document.lines[0];
  const mainLines = document.lines.filter((line) => !line.backgroundOf);
  useEffect(() => {
    if (!selectedLine) return;
    const preceding = document.lines.slice(0, document.lines.findIndex((line) => line.id === selectedLine.id)).filter((line) => !line.backgroundOf).at(-1);
    setBackgroundTargetId(selectedLine.backgroundOf ?? preceding?.id ?? mainLines.find((line) => line.id !== selectedLine.id)?.id ?? '');
  }, [selectedLine?.id]);
  const mainIds = mainLines.map((line) => line.id);
  const selectedMainLines = selectedLine?.backgroundOf ? [] : selection?.kind === 'lines' && selection.ids.length
    ? mainLines.filter((line) => selection.ids.includes(line.id))
    : selectedLine && !selectedLine.backgroundOf ? [selectedLine] : [];
  const selectedAgents = selectedMainLines.map((line) => line.agentRefs[0] ?? '');
  const agentValue = selectedAgents.every((value) => value === selectedAgents[0]) ? selectedAgents[0] ?? '' : '__mixed__';
  const selectedWordLineIndexes = selection?.kind === 'words'
    ? document.lines.flatMap((line, index) => line.words.some((word) => selection.ids.includes(word.id)) ? [index] : []) : [];
  const rubyBaseLine = selection?.kind === 'words' && selection.ids.length > 1 ? document.lines.find((line) => line.words.some((word) => word.id === selection.ids[0])) : undefined;
  const rubyBaseWords = rubyBaseLine && selection?.kind === 'words' ? rubyBaseLine.words.filter((word) => selection.ids.includes(word.id)) : [];
  const canCreateRubyBase = Boolean(rubyBaseLine && rubyBaseWords.length === selection?.ids.length && rubyBaseWords.length > 1 &&
    rubyBaseLine.words.findIndex((word) => word.id === rubyBaseWords[0].id) + rubyBaseWords.length - 1 === rubyBaseLine.words.findIndex((word) => word.id === rubyBaseWords.at(-1)?.id));
  const createRubyBase = () => {
    if (!canCreateRubyBase || !rubyBaseLine || !rubyBaseReading) return;
    const firstId = rubyBaseWords[0].id;
    if (dispatch({ type: 'batch', commands: [
      { type: 'merge-ruby-base', lineId: rubyBaseLine.id, wordIds: rubyBaseWords.map((word) => word.id) },
      { type: 'add-ruby', lineId: rubyBaseLine.id, wordId: firstId, reading: rubyBaseReading },
    ] })) {
      setSelection({ kind: 'words', lineId: rubyBaseLine.id, ids: [firstId], anchorId: firstId, activeId: firstId, rubyId: null });
      setRubyBaseOpen(false); setRubyBaseReading('');
    }
  };
  const selectLine = (line: LyricLine, shift = false, toggle = false) => {
    const id = line.backgroundOf ?? line.id;
    const previous = selection?.kind === 'lines' ? selection : null;
    const ids = selectIds(mainIds, previous?.ids ?? [], previous?.anchorId ?? id, id, shift, toggle);
    setSelection({ kind: 'lines', ids, anchorId: shift || toggle ? previous?.anchorId ?? id : id, activeId: line.id });
    props.onSelectLine?.(line.id);
    props.onSelectUnit?.(line.id, null, null);
  };
  const selectWord = (line: LyricLine, word: LyricWord, shift = false, toggle = false, rubyId: string | null = null) => {
    const previous = selection?.kind === 'words' ? selection : null;
    const order = document.lines.flatMap((item) => item.words.map((value) => value.id));
    const ids = selectIds(order, previous?.ids ?? [], previous?.anchorId ?? word.id, word.id, shift, toggle);
    setSelection({ kind: 'words', lineId: line.id, ids, anchorId: shift || toggle ? previous?.anchorId ?? word.id : word.id, activeId: word.id, rubyId });
    props.onSelectLine?.(line.id);
    props.onSelectUnit?.(line.id, word.id, rubyId);
  };
  const selectRomanizationContent = (lineId: string, trackId: string, contentId: string, shift = false, toggle = false) => {
    const previous = selection?.kind === 'romanization-content' && selection.trackId === trackId && selection.lineId === lineId ? selection : null;
    const order = document.romanizationTracks.find((track) => track.id === trackId)?.contents.filter((content) => content.lineId === lineId).map((content) => content.id) ?? [];
    const ids = selectIds(order, previous?.ids ?? [], previous?.anchorId ?? contentId, contentId, shift, toggle);
    setSelection({ kind: 'romanization-content', lineId, trackId, contentId, ids, anchorId: shift || toggle ? previous?.anchorId ?? contentId : contentId, activeId: contentId });
    props.onSelectLine?.(lineId);
  };
  const selectRomanizationUnit = (lineId: string, trackId: string, contentId: string, unitId: string, shift = false, toggle = false) => {
    const previous = selection?.kind === 'romanization-unit' && selection.contentId === contentId ? selection : null;
    const content = document.romanizationTracks.find((track) => track.id === trackId)?.contents.find((item) => item.id === contentId);
    const order = content?.kind === 'timed' ? content.units.map((unit) => unit.id) : [];
    const ids = selectIds(order, previous?.ids ?? [], previous?.anchorId ?? unitId, unitId, shift, toggle);
    setSelection({ kind: 'romanization-unit', lineId, trackId, contentId, ids, anchorId: shift || toggle ? previous?.anchorId ?? unitId : unitId, activeId: unitId });
    props.onSelectLine?.(lineId);
  };
  const dispatch = (command: LyricCommand) => {
    try { apply(command); setMessage(''); return true; }
    catch (error) { setMessage(error instanceof Error ? error.message : '编辑失败'); return false; }
  };
  const currentSelection = (): EditorSelection | null => selection ?? (selectedLine ? { kind: 'lines', ids: [selectedLine.backgroundOf ?? selectedLine.id], anchorId: selectedLine.backgroundOf ?? selectedLine.id, activeId: selectedLine.id } : null);
  const copy = () => {
    const current = currentSelection();
    if (!current?.ids.length) return null;
    const next = copySelection(document, current);
    clipboardToken.current = crypto.randomUUID();
    setClipboard(next);
    setMessage('已复制到编辑器剪贴板');
    return next;
  };
  const cut = () => {
    const current = currentSelection();
    if (!current?.ids.length) return null;
    const next = copySelection(document, current);
    if (dispatch(cutSelection(document, current))) {
      setClipboard(next);
      clipboardToken.current = crypto.randomUUID();
      const available = current.kind !== 'lines' ? current.lineId : mainIds.filter((id) => !current.ids.includes(id)).at(-1);
      setSelection(available ? { kind: 'lines', ids: [available], anchorId: available, activeId: available } : { kind: 'lines', ids: [], anchorId: '', activeId: '' });
      return next;
    }
    return null;
  };
  const paste = (next: EditorClipboard | null, plain?: string) => {
    if (!next && !plain) return;
    try {
      const result = next ? pasteRich(document, next, currentSelection()) : pastePlain(document, plain!, currentSelection());
      if (dispatch(result.command)) setSelection(result.selection);
    } catch (error) { setMessage(error instanceof Error ? error.message : '粘贴失败'); }
  };
  const selectAll = (invert: boolean) => {
    if (selection?.kind === 'romanization-unit') {
      const content = document.romanizationTracks.find((track) => track.id === selection.trackId)?.contents.find((item) => item.id === selection.contentId);
      const order = content?.kind === 'timed' ? content.units.map((unit) => unit.id) : [];
      const ids = invert ? invertIds(order, selection.ids) : order;
      setSelection({ ...selection, ids, anchorId: ids[0] ?? '', activeId: ids.at(-1) ?? '' });
    } else if (selection?.kind === 'romanization-content') {
      const order = document.romanizationTracks.find((track) => track.id === selection.trackId)?.contents.filter((content) => content.lineId === selection.lineId).map((content) => content.id) ?? [];
      const ids = invert ? invertIds(order, selection.ids) : order;
      setSelection({ ...selection, ids, anchorId: ids[0] ?? '', activeId: ids.at(-1) ?? '' });
    } else if (selection?.kind === 'words') {
      const order = document.lines.flatMap((line) => line.words.map((word) => word.id));
      const ids = invert ? invertIds(order, selection.ids) : order;
      setSelection({ ...selection, ids, anchorId: ids[0] ?? '', activeId: ids.at(-1) ?? '' });
    } else {
      const ids = invert ? invertIds(mainIds, selection?.kind === 'lines' ? selection.ids : []) : mainIds;
      setSelection({ kind: 'lines', ids, anchorId: ids[0] ?? '', activeId: ids.at(-1) ?? '' });
    }
  };
  const moveSelectedWords = (direction: -1 | 1) => {
    if (selection?.kind !== 'words' || !selection.ids.length) return;
    const edge = direction < 0 ? Math.min(...selectedWordLineIndexes) : Math.max(...selectedWordLineIndexes);
    const target = document.lines[edge + direction];
    if (!target) return;
    try {
      if (dispatch(moveWordsAcrossLine(document, selection, target.id))) {
        setSelection({ ...selection, lineId: target.id, rubyId: null });
        props.onSelectLine?.(target.id);
      }
    } catch (error) { setMessage(error instanceof Error ? error.message : '跨行移动失败'); }
  };
  const startDrag = (event: DragEvent, source: DragSource) => {
    dragging.current = source;
    event.dataTransfer.effectAllowed = 'copyMove';
    event.dataTransfer.setData('text/plain', source.kind === 'line' ? lineText(document.lines.find((line) => line.id === source.lineId)!) : document.lines.find((line) => line.id === source.lineId)!.words.find((word) => word.id === source.wordId)!.text);
  };
  const overDrop = (event: DragEvent, key: string) => {
    if (!dragging.current) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = event.ctrlKey || event.metaKey ? 'copy' : 'move';
    setDropTarget(key);
  };
  const applyLineDrop = (source: DragSource, target: LyricLine, copyMode: boolean) => {
    const targetId = target.backgroundOf ?? target.id;
    if (source.kind === 'line') {
      if (source.lineId === targetId) return;
      if (copyMode) {
        const item = copySelection(document, { kind: 'lines', ids: [source.lineId], anchorId: source.lineId, activeId: source.lineId });
        const result = pasteRich(document, item, { kind: 'lines', ids: [targetId], anchorId: targetId, activeId: targetId });
        if (dispatch(result.command)) setSelection(result.selection);
      } else if (dispatch({ type: 'move-line', lineId: source.lineId, afterLineId: targetId })) setSelection({ kind: 'lines', ids: [source.lineId], anchorId: source.lineId, activeId: source.lineId });
      return;
    }
    applyWordDrop(source, target, target.words.at(-1)?.id ?? null, copyMode);
  };
  const applyWordDrop = (source: DragSource, targetLine: LyricLine, afterWordId: string | null, copyMode: boolean) => {
    if (source.kind !== 'word') return;
    if (source.lineId === targetLine.id && source.wordId === afterWordId) return;
    const sourceSelection: Extract<EditorSelection, { kind: 'words' }> = { kind: 'words', lineId: source.lineId, ids: [source.wordId], anchorId: source.wordId, activeId: source.wordId, rubyId: null };
    if (copyMode) {
      const item = copySelection(document, sourceSelection);
      const targetSelection: EditorSelection = afterWordId
        ? { kind: 'words', lineId: targetLine.id, ids: [afterWordId], anchorId: afterWordId, activeId: afterWordId, rubyId: null }
        : { kind: 'lines', ids: [targetLine.backgroundOf ?? targetLine.id], anchorId: targetLine.backgroundOf ?? targetLine.id, activeId: targetLine.id };
      const result = pasteRich(document, item, targetSelection);
      if (dispatch(result.command)) setSelection(result.selection);
    } else {
      const command = source.lineId === targetLine.id
        ? { type: 'move-word' as const, lineId: source.lineId, wordId: source.wordId, toLineId: targetLine.id, afterWordId }
        : moveWordsAcrossLine(document, sourceSelection, targetLine.id, afterWordId);
      if (dispatch(command)) setSelection({ ...sourceSelection, lineId: targetLine.id });
    }
  };
  const dropLine = (event: DragEvent, target: LyricLine) => {
    const source = dragging.current;
    if (!source) return;
    event.preventDefault(); event.stopPropagation();
    dragging.current = null; setDropTarget(null);
    applyLineDrop(source, target, event.ctrlKey || event.metaKey);
  };
  const dropWord = (event: DragEvent, targetLine: LyricLine, afterWordId: string | null) => {
    const source = dragging.current;
    if (!source) return;
    event.preventDefault(); event.stopPropagation();
    dragging.current = null; setDropTarget(null);
    applyWordDrop(source, targetLine, afterWordId, event.ctrlKey || event.metaKey);
  };
  const touchHandle = (source: DragSource) => ({
    onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (event.pointerType !== 'touch') return;
      event.currentTarget.setPointerCapture(event.pointerId);
      touchDrag.current = { source, target: null };
    },
    onPointerMove: (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (event.pointerType !== 'touch' || !touchDrag.current) return;
      const element = event.currentTarget.ownerDocument.elementFromPoint(event.clientX, event.clientY);
      const word = element?.closest('[data-word-id]');
      const line = element?.closest('[data-line-id]');
      const target = source.kind === 'word' && word ? `word:${word.getAttribute('data-word-id')}` : line ? `line:${line.getAttribute('data-line-id')}` : null;
      touchDrag.current.target = target;
      setDropTarget(target);
    },
    onPointerUp: (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (event.pointerType !== 'touch' || !touchDrag.current) return;
      const { target } = touchDrag.current;
      touchDrag.current = null;
      setDropTarget(null);
      if (!target) return;
      const id = target.slice(5);
      if (target.startsWith('line:')) {
        const line = document.lines.find((item) => item.id === id);
        if (line) applyLineDrop(source, line, false);
      } else {
        const line = document.lines.find((item) => item.words.some((word) => word.id === id));
        if (line) applyWordDrop(source, line, id, false);
      }
    },
    onPointerCancel: () => { touchDrag.current = null; setDropTarget(null); },
  });
  const sublyric = (line: LyricLine, index: number, text: string) => {
    const items = line.translations.map((item, i) => i === index ? { ...item, text } : item);
    dispatch({ type: 'set-sublyrics', lineId: line.id, kind: 'translations', items });
  };
  const moveLine = (line: LyricLine, direction: -1 | 1) => {
    const index = mainLines.findIndex((item) => item.id === line.id);
    if (line.backgroundOf || index + direction < 0 || index + direction >= mainLines.length) return;
    dispatch({ type: 'move-line', lineId: line.id, afterLineId: direction < 0 ? mainLines[index - 2]?.id ?? null : mainLines[index + 1].id });
  };
  const moveWord = (line: LyricLine, word: LyricWord, direction: -1 | 1) => {
    const index = line.words.findIndex((item) => item.id === word.id);
    if (index + direction < 0 || index + direction >= line.words.length) return;
    dispatch({ type: 'move-word', lineId: line.id, wordId: word.id, toLineId: line.id, afterWordId: direction < 0 ? line.words[index - 2]?.id ?? null : line.words[index + 1].id });
  };
  const navigateWord = (wordId: string, direction: -1 | 1) => {
    const order = document.lines.flatMap((line) => line.words.map((word) => ({ lineId: line.id, wordId: word.id })));
    const target = order[order.findIndex((item) => item.wordId === wordId) + direction];
    if (!target) return;
    const input = wordInputs.current.get(target.wordId);
    if (input) input.focus();
    else {
      pendingFocus.current = target.wordId;
      requestLocate(target.lineId);
    }
  };
  const wordView = (line: LyricLine, word: LyricWord, index: number) => <LyricWordView key={word.id} id={word.id}
    selected={selection?.kind === 'words' && selection.ids.includes(word.id)} dropTarget={dropTarget === `word:${word.id}`}
    onSelect={(shift, toggle) => selectWord(line, word, shift, toggle)}
    onDragOver={(event) => { if (dragging.current?.kind === 'word') overDrop(event, `word:${word.id}`); }}
    onDrop={(event) => dropWord(event, line, word.id)}>
    <RubyWordEditor lineId={line.id} word={word} selectedRubyId={selection?.kind === 'words' && selection.activeId === word.id ? selection.rubyId : null}
      onSelectRuby={(rubyId) => selectWord(line, word, false, false, rubyId)} apply={dispatch}
      requestAddSerial={rubyShortcut?.wordId === word.id ? rubyShortcut.serial : undefined} />
    <div className={styles.wordMain}>
      <button className={styles.dragHandle} draggable aria-label={`拖动词 ${word.text}`} title="拖放排序；按 Ctrl 复制" onDragStart={(event) => startDrag(event, { kind: 'word', lineId: line.id, wordId: word.id })} onDragEnd={() => { dragging.current = null; setDropTarget(null); }} {...touchHandle({ kind: 'word', lineId: line.id, wordId: word.id })}>⋮⋮</button>
      <DraftInput value={word.text} label={`词 ${word.text}`} onFocus={() => selectWord(line, word)}
        readOnly={editingWordId !== word.id} onEdit={() => setEditingWordId(word.id)} onExit={() => setEditingWordId(null)}
        onCommit={(text) => {
          const shortcut = text.endsWith('|');
          const next = shortcut ? text.slice(0, -1) : text;
          if (!next) { setMessage('Ruby 快捷输入需要正文'); return; }
          if (dispatch({ type: 'edit-word', lineId: line.id, wordId: word.id, text: next }) && shortcut) setRubyShortcut({ wordId: word.id, serial: ++rubyShortcutSerial.current });
        }}
        onSplit={(at) => dispatch({ type: 'split-word', lineId: line.id, wordId: word.id, at: utf16ToCodePoint(word.text, at) })}
        onMove={(direction) => moveWord(line, word, direction)} onNavigate={(direction) => navigateWord(word.id, direction)}
        inputRef={(node) => { if (node) { wordInputs.current.set(word.id, node); if (pendingFocus.current === word.id) { pendingFocus.current = null; node.focus(); } } else wordInputs.current.delete(word.id); }} />
      <button aria-label={`词前移 ${word.text}`} disabled={index === 0} onClick={() => moveWord(line, word, -1)}>←</button>
      <button aria-label={`词后移 ${word.text}`} disabled={index === line.words.length - 1} onClick={() => moveWord(line, word, 1)}>→</button>
      <button aria-label={`拆分词 ${word.text}`} title="按光标位置拆分；输入中可按 F8" onClick={() => {
        const at = Math.floor(Array.from(word.text).length / 2);
        dispatch({ type: 'split-word', lineId: line.id, wordId: word.id, at });
      }}>拆</button>
      <button aria-label={`合并前词 ${word.text}`} disabled={index === 0} onClick={() => dispatch({ type: 'merge-words', lineId: line.id, firstWordId: line.words[index - 1].id, secondWordId: word.id })}>合</button>
      <button aria-label={`删除词 ${word.text}`} onClick={() => dispatch({ type: 'delete-word', lineId: line.id, wordId: word.id })}>×</button>
    </div>
    <TimePair begin={word.beginUs} end={word.endUs} label={`词 ${word.text}`} onCommit={(beginUs, endUs) => dispatch({ type: 'set-word-time', lineId: line.id, wordId: word.id, beginUs, endUs })} />
    <label className={styles.emptyBeat}>空拍 <input type="number" min="0" max="32" aria-label={`词 ${word.text}空拍数`} value={word.emptyBeat} onChange={(event) => dispatch({ type: 'set-word-empty-beat', lineId: line.id, wordId: word.id, emptyBeat: Number(event.target.value) })} /></label>
  </LyricWordView>;
  return <div className={`${styles.page} ${props.embedded ? styles.embeddedPage : ''}`} onCopy={(event) => {
    if (isTextInput(event.target)) return;
    const item = copy();
    if (item) { event.clipboardData.setData('text/plain', item.text); event.clipboardData.setData(CLIPBOARD_MIME, clipboardToken.current); event.preventDefault(); }
  }} onCut={(event) => {
    if (isTextInput(event.target)) return;
    const item = cut();
    if (item) { event.clipboardData.setData('text/plain', item.text); event.clipboardData.setData(CLIPBOARD_MIME, clipboardToken.current); event.preventDefault(); }
  }} onPaste={(event) => {
    if (isTextInput(event.target)) return;
    const text = event.clipboardData.getData('text/plain');
    if (!text) return;
    event.preventDefault();
    paste(clipboard && event.clipboardData.getData(CLIPBOARD_MIME) === clipboardToken.current ? clipboard : null, text);
  }} onKeyDown={(event) => {
    if (isTextInput(event.target) || event.nativeEvent.isComposing) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') { event.preventDefault(); selectAll(false); }
    if (event.key === 'Escape') { event.preventDefault(); setSelection({ kind: 'lines', ids: [], anchorId: '', activeId: '' }); }
  }}>
    <EditorMenu {...props} simpleLayout={simpleLayout} onToggleLayout={() => setSimpleLayout((value) => !value)} onMetadata={() => setSettingsDialog('metadata')} onSingers={() => setSettingsDialog('singers')} />
    {(message || props.error) && <p role="alert" className={styles.error}>{message || props.error}</p>}
    <nav className={styles.modeTabs} aria-label="工作模式"><button aria-current={mode === 'edit' ? 'page' : undefined} onClick={() => setMode('edit')}>编辑</button><button aria-current={mode === 'sync' ? 'page' : undefined} onClick={() => setMode('sync')}>打轴</button><button aria-current={mode === 'preview' ? 'page' : undefined} onClick={() => setMode('preview')}>预览</button><button aria-current={mode === 'auxiliary' ? 'page' : undefined} onClick={() => setMode('auxiliary')}>项目辅助</button></nav>
    {mode === 'auxiliary' && <section className={styles.auxiliaryPlaceholder}><h1>项目辅助</h1><p>候选、任务、词典与审核流程将在后续阶段整理到此处。歌词文档与播放器保持当前状态。</p></section>}
    {mode === 'preview' && <Suspense fallback={<p>正在载入预览…</p>}><PreviewMode document={document} transport={props.transport} onSelectLine={props.onSelectLine} /></Suspense>}
    {mode === 'sync' && <SyncPanel document={document} currentLineId={selectedLine?.id ?? null} apply={dispatch} transport={props.transport}
      onCursor={(cursor) => { const line = document.lines.find((item) => item.id === cursor.lineId)!; const word = line.words.find((item) => item.id === cursor.wordId)!; selectWord(line, word, false, false, cursor.rubyUnitId); requestLocate(line.id); }} />}
    {mode === 'edit' && <EditorRibbon selection={selection} canPaste={Boolean(clipboard)}
      canMoveUp={selectedWordLineIndexes.length > 0 && selectedWordLineIndexes[0] > 0}
      canMoveDown={selectedWordLineIndexes.length > 0 && selectedWordLineIndexes.at(-1) !== document.lines.length - 1}
      copy={() => { copy(); }} cut={() => { cut(); }} paste={() => paste(clipboard)}
      selectAll={() => selectAll(false)} invertSelection={() => selectAll(true)}
      clearSelection={() => setSelection({ kind: 'lines', ids: [], anchorId: '', activeId: '' })}
      moveUp={() => moveSelectedWords(-1)} moveDown={() => moveSelectedWords(1)} openSegmentation={() => setSegmentationOpen(true)} openBatchTools={() => setBatchToolsOpen(true)}
      canCreateRubyBase={canCreateRubyBase} createRubyBase={() => setRubyBaseOpen(true)} />}
    {(mode === 'edit' || mode === 'sync') && <div className={`${styles.layout} ${simpleLayout ? styles.simpleLayout : ''}`}><aside className={styles.outline}><h2>大纲</h2>
      {document.lines.map((line, index) => <div className={styles.outlineRow} key={line.id}>
        <button className={selection?.kind === 'lines' ? selection.ids.includes(line.backgroundOf ?? line.id) ? styles.selected : '' : selectedLine?.id === line.id ? styles.selected : ''}
          onClick={(event) => { selectLine(line, event.shiftKey, event.ctrlKey || event.metaKey); requestLocate(line.id); }}>
          {index + 1} {line.backgroundOf ? '↳ ' : ''}{lineText(line) || '空行'}
        </button>
        {!line.backgroundOf && <span className={styles.outlineOrder}>
          <button aria-label={`大纲上移 ${lineText(line) || '空行'}`} disabled={mainLines[0]?.id === line.id} onClick={() => moveLine(line, -1)}>↑</button>
          <button aria-label={`大纲下移 ${lineText(line) || '空行'}`} disabled={mainLines.at(-1)?.id === line.id} onClick={() => moveLine(line, 1)}>↓</button>
        </span>}
      </div>)}
    </aside>
      <main className={styles.canvas}><div className={styles.canvasHeader}><h1>歌词编辑</h1><button onClick={() => dispatch({ type: 'insert-line', afterLineId: document.lines.at(-1)?.id ?? null })}>新增歌词行</button></div>
        <LyricList lines={document.lines} locate={locate} renderLine={(line) => <LyricLineView key={line.id} line={line}
          selected={selection ? selection.kind === 'lines' ? selection.ids.includes(line.backgroundOf ?? line.id) : selection.kind === 'words' ? line.words.some((word) => selection.ids.includes(word.id)) : line.id === selection.lineId : selectedLine?.id === line.id}
          playhead={props.playheadLineId === line.id} dropTarget={dropTarget === `line:${line.id}`}
          onSelect={(shift, toggle) => selectLine(line, shift, toggle)} onMove={(direction) => moveLine(line, direction)}
          onDragOver={(event) => overDrop(event, `line:${line.id}`)} onDrop={(event) => dropLine(event, line)}>
          <div className={styles.lineHeader}>{!line.backgroundOf && <button className={styles.dragHandle} draggable aria-label={`拖动行 ${lineText(line)}`} title="拖放排序；按 Ctrl 复制" onDragStart={(event) => startDrag(event, { kind: 'line', lineId: line.id })} onDragEnd={() => { dragging.current = null; setDropTarget(null); }} {...touchHandle({ kind: 'line', lineId: line.id })}>⋮⋮</button>}<span>{line.backgroundOf ? '背景' : '主唱'} · {line.id}</span><TimePair begin={line.beginUs} end={line.endUs} label={`行 ${line.id}`} onCommit={(beginUs, endUs) => dispatch({ type: 'set-line-time', lineId: line.id, beginUs, endUs })} />
            {!line.backgroundOf && <><button aria-label={`行上移 ${lineText(line)}`} disabled={mainLines[0]?.id === line.id} onClick={() => moveLine(line, -1)}>↑</button><button aria-label={`行下移 ${lineText(line)}`} disabled={mainLines.at(-1)?.id === line.id} onClick={() => moveLine(line, 1)}>↓</button></>}
            <button onClick={() => dispatch({ type: 'insert-line', afterLineId: line.backgroundOf ?? line.id })}>后插行</button><button onClick={() => dispatch({ type: 'delete-line', lineId: line.id })}>删行</button></div>
          <div className={styles.words}>{line.words.map((word, index) => wordView(line, word, index))}<button onClick={() => dispatch({ type: 'insert-word', lineId: line.id, afterWordId: line.words.at(-1)?.id ?? null, word: createWord('新词') })}>加词</button></div>
          {!line.backgroundOf && <div className={styles.sublyrics}><div><strong>翻译</strong>{line.translations.map((item, index) => <div key={index}><DraftInput value={item.text} label={`翻译 ${index + 1}`} onCommit={(text) => sublyric(line, index, text)} /><small>{item.language ?? '未指定语言'}</small></div>)}<button onClick={() => dispatch({ type: 'set-sublyrics', lineId: line.id, kind: 'translations', items: [...line.translations, { language: null, text: '' }] })}>添加</button></div></div>}
          {!line.backgroundOf && <div className={styles.romanizationTracks}>
            {document.romanizationTracks.map((track, trackIndex) => {
              const contents = track.contents.filter((content) => content.lineId === line.id);
              return <div key={track.id}>
                <div className={styles.romanizationTrackHeader}>
                  <span>轨道 {trackIndex + 1}</span>
                  <DraftInput value={track.language ?? ''} label={`音译轨道 ${trackIndex + 1} 语言`} placeholder="语言" onCommit={(language) => dispatch({ type: 'set-romanization-track-language', trackId: track.id, language: language || null })} />
                  <button disabled={trackIndex === 0} onClick={() => dispatch({ type: 'move-romanization-track', trackId: track.id, direction: -1 })}>轨道上移</button>
                  <button disabled={trackIndex === document.romanizationTracks.length - 1} onClick={() => dispatch({ type: 'move-romanization-track', trackId: track.id, direction: 1 })}>轨道下移</button>
                  <button onClick={() => dispatch({ type: 'insert-romanization-content', trackId: track.id, content: { id: crypto.randomUUID(), lineId: line.id, kind: 'plain', text: '' } })}>添加音译</button>
                  <button onClick={() => dispatch({ type: 'delete-romanization-track', trackId: track.id })}>删除轨道</button>
                </div>
                {contents.map((content, contentIndex) => {
                  const previousIndex = contentIndex ? track.contents.findIndex((item) => item.id === contents[contentIndex - 1].id) : -1;
                  return <RomanizationRow key={content.id} track={track} content={content}
                    selectedContent={selection?.kind === 'romanization-content' && selection.ids.includes(content.id)}
                    selectedUnitIds={selection?.kind === 'romanization-unit' && selection.contentId === content.id ? selection.ids : []}
                    selectContent={(shift, toggle) => selectRomanizationContent(line.id, track.id, content.id, shift, toggle)}
                    selectUnit={(unitId, shift, toggle) => selectRomanizationUnit(line.id, track.id, content.id, unitId, shift, toggle)} apply={dispatch}
                    canMoveUp={contentIndex > 0} canMoveDown={contentIndex < contents.length - 1}
                    moveUp={() => dispatch({ type: 'move-romanization-content', trackId: track.id, contentId: content.id, lineId: line.id, afterContentId: track.contents[previousIndex - 1]?.id ?? null })}
                    moveDown={() => dispatch({ type: 'move-romanization-content', trackId: track.id, contentId: content.id, lineId: line.id, afterContentId: contents[contentIndex + 1].id })} />;
                })}
              </div>;
            })}
            <button onClick={() => {
              const trackId = crypto.randomUUID(), contentId = crypto.randomUUID();
              if (dispatch({ type: 'batch', commands: [
                { type: 'add-romanization-track', track: { id: trackId, language: null, contents: [] } },
                { type: 'insert-romanization-content', trackId, content: { id: contentId, lineId: line.id, kind: 'plain', text: '' } },
              ] })) selectRomanizationContent(line.id, trackId, contentId);
            }}>新增音译轨道</button>
          </div>}
        </LyricLineView>} />
      </main>
      <aside className={styles.inspector}><h2>属性</h2>{selectedLine && <>
        <p>已选行：{selection?.kind === 'lines' && selection.ids.length > 1 ? `${selection.ids.length} 行` : lineText(selectedLine) || '空行'}</p>
        {selectedMainLines.length > 0 && <>
          <label><input type="checkbox" checked={selectedMainLines.every((line) => line.ignoreSync)} onChange={(event) => dispatch({ type: 'batch', commands: selectedMainLines.map((line) => ({ type: 'set-ignore-sync', lineId: line.id, ignoreSync: event.target.checked })) })} /> 跳过打轴</label>
          <label>歌手 <select value={agentValue} onChange={(event) => dispatch({ type: 'batch', commands: selectedMainLines.map((line) => ({ type: 'set-line-agents', lineId: line.id, agentRefs: event.target.value ? [event.target.value] : [] })) })}>
            {agentValue === '__mixed__' && <option value="__mixed__" disabled>混合值</option>}
            <option value="">未指定</option>{document.agents.map((agent) => <option value={agent.id} key={agent.id}>{agent.name ?? agent.id}</option>)}
          </select></label>
        </>}
        {selection?.kind !== 'lines' || selection.ids.length <= 1 ? <>
          {!selectedLine.backgroundOf && <div className={styles.lineStructureActions}>
            <button disabled={selectedLine.words.length < 2} onClick={() => setSplitLineId(selectedLine.id)}>拆分行…</button>
            <button disabled={mainLines.at(-1)?.id === selectedLine.id} onClick={() => {
              const next = mainLines[mainLines.findIndex((line) => line.id === selectedLine.id) + 1];
              if (next) dispatch({ type: 'merge-lines', firstLineId: selectedLine.id, secondLineId: next.id });
            }}>合并下一行</button>
          </div>}
          <label><input type="checkbox" checked={Boolean(selectedLine.backgroundOf)} onChange={(event) => {
            if (event.target.checked && !backgroundTargetId) { setMessage('请先选择所属主行'); return; }
            dispatch({ type: 'set-background-of', lineId: selectedLine.id, parentLineId: event.target.checked ? backgroundTargetId : null });
          }} /> 背景歌词</label>
          <label>所属主行 <select value={selectedLine.backgroundOf ?? backgroundTargetId} onChange={(event) => {
            setBackgroundTargetId(event.target.value);
            if (selectedLine.backgroundOf) dispatch({ type: 'set-background-of', lineId: selectedLine.id, parentLineId: event.target.value });
          }}>
            <option value="">请选择</option>{mainLines.filter((line) => line.id !== selectedLine.id && !document.lines.some((item) => item.backgroundOf === line.id && item.id !== selectedLine.id)).map((line) => <option key={line.id} value={line.id}>{mainLines.indexOf(line) + 1} · {lineText(line) || '空行'}</option>)}
          </select></label>
          {selectedLine.backgroundOf && <p>歌手继承自所属主行：{document.lines.find((line) => line.id === selectedLine.backgroundOf)?.agentRefs.map((id) => document.agents.find((agent) => agent.id === id)?.name ?? id).join('、') || '未指定'}</p>}
        </> : null}
      </>}
      </aside></div>}
    {settingsDialog === 'metadata' && <SettingsDialog title="元数据编辑" close={() => setSettingsDialog(null)}><MetadataPanel document={document} apply={dispatch} /></SettingsDialog>}
    {settingsDialog === 'singers' && <SingerDialog document={document} apply={dispatch} close={() => setSettingsDialog(null)} />}
    {segmentationOpen && <SegmentationPanel document={document} selection={selection} currentLineId={selectedLine?.id ?? null} apply={dispatch} close={() => setSegmentationOpen(false)} />}
    {batchToolsOpen && <BatchToolsPanel document={document} selection={selection} currentLineId={selectedLine?.id ?? null} apply={dispatch} close={() => setBatchToolsOpen(false)} />}
    {rubyBaseOpen && <div className={styles.dialogBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setRubyBaseOpen(false); }}><section className={styles.dialog} role="dialog" aria-modal="true" aria-label="整体 Ruby"><div className={styles.dialogHeader}><h2>整体 Ruby</h2><button aria-label="关闭整体 Ruby" onClick={() => setRubyBaseOpen(false)}>×</button></div><p>base：{rubyBaseWords.map((word) => word.text).join('')}</p><label>读音 <input autoFocus value={rubyBaseReading} onChange={(event) => setRubyBaseReading(event.target.value)} onKeyDown={(event) => { if (event.nativeEvent.isComposing) return; if (event.key === 'Enter') createRubyBase(); if (event.key === 'Escape') setRubyBaseOpen(false); }} /></label><p>合并相邻词后创建一个整体读音；其他词和时间保持原样。</p><div className={styles.dialogActions}><button onClick={() => setRubyBaseOpen(false)}>取消</button><button disabled={!rubyBaseReading} onClick={createRubyBase}>应用（一次撤销）</button></div></section></div>}
    {splitLineId && document.lines.find((line) => line.id === splitLineId) && <LineSplitDialog key={splitLineId} line={document.lines.find((line) => line.id === splitLineId)!}
      background={document.lines.find((line) => line.backgroundOf === splitLineId) ?? null}
      attached={document.romanizationTracks.flatMap((track) => track.contents.filter((content) => content.lineId === splitLineId).map((content) => ({ track, content })))}
      close={() => setSplitLineId(null)}
      submit={(beforeWordId, contentIdsForNewLine, backgroundTarget) => dispatch({ type: 'split-line', lineId: splitLineId, beforeWordId, newLineId: crypto.randomUUID(), contentIdsForNewLine, backgroundTarget })} />}
  </div>;
}
