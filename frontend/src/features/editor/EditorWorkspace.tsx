import { Select } from '../../shared/Select';
import { useAudioReview } from '../AudioReviewContext';
import { VocalPanel } from '../VocalPanel';
import { VOCAL_LINE_MIME } from '../VocalTracks';
import vocalStyles from '../vocal.module.css';
import type { ProjectDocument, ProjectCommand } from '../../domain/project-document';
import { visibleLineOrdinals, type OutputIssue } from '../../adapters/output-validation';
import { AcquisitionStore } from '../../acquisition-store';
import { useSearchConditions } from '../useSearchConditions';
import { LyricAcquisition } from '../LyricAcquisition';
import { BooleanField, IconButton } from '../../shared/Controls';
import { PackagingPanel } from '../PackagingPanel';
import { RomanizationGenerationDialog } from './RomanizationGenerationDialog';
import { lineStructureIssues } from '../../domain/line-structure';
import { useObjectDrag, type DragSource } from './object-drag';
import { lazy, Suspense, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type RefObject } from 'react';
import type { LyricCommand } from '../../domain/lyric-commands';
import { createLine, createWord, lineText, type LyricDocument, type LyricLine, type LyricWord } from '../../domain/lyric-document';
import { utf16ToCodePoint } from '../../domain/text-boundaries';
import { DEFAULT_SEGMENT_OPTIONS, distributeSegmentTime, segmentText } from '../../domain/segmentation';
import { distributeRubyTime, splitReadingMora } from '../../domain/ruby-editing';
import { copySelection, cutSelection, deleteSelection, invertIds, moveWordsAcrossLine, pastePlain, pasteRich, selectIds, selectionLineId, type EditorClipboard, type EditorSelection } from './editing-actions';
import { LyricList } from './LyricList';
import { LyricLine as LyricLineView } from './LyricLine';
import { LyricWord as LyricWordView } from './LyricWord';
import { InlineAdd } from './InlineAdd';
import { DraftInput, TimePair } from './EditorFields';
import { ColumnSeparator } from './ColumnSeparator';
import { OutlineRow } from './OutlineRow';
import { COLUMN_LIMITS, COLUMN_STORAGE, readColumnPreferences, renderedColumns, type ColumnPreferences, type ColumnSide } from './column-preferences';
import { EditorMenu } from './EditorMenu';
import { EditorRibbon } from './EditorRibbon';
import { SegmentationPanel } from './SegmentationPanel';
import { BatchToolsPanel } from './BatchToolsPanel';
import { RubyWordEditor } from './RubyWordEditor';
import { TranslationEditor } from './TranslationEditor';
import { RomanizationRow } from './RomanizationRow';
import { LineSplitDialog } from './LineSplitDialog';
import { syncUnits } from '../../domain/sync-editing';
import { SyncPanel } from './SyncPanel';
import { MetadataPanel } from './MetadataPanel';
import { SingerSelection } from './SingerSelection';
import { SingerDialog } from './SingerDialog';
import { SettingsDialog } from './SettingsDialog';
import { EditorContextMenu, type ContextAction } from './EditorContextMenu';
import { RubyGenerationDialog } from './RubyGenerationDialog';
import type { TransportHandle } from '../MediaTransport';
import type { LyricFormat } from '../../adapters/lyric-formats';
import styles from './semantic-editor.module.css';

const CLIPBOARD_MIME = 'application/x-lazulite-lyric';
const PreviewMode = lazy(() => import('./PreviewMode').then((module) => ({ default: module.PreviewMode })));

type Props = {
  project?: ProjectDocument;
  applyProject?: (command: ProjectCommand) => void;
  audioDurationMs?: number;
  onTimelineHost?: (host: HTMLDivElement | null) => void;
  assignmentError?: { lineId: string; message: string; objectIds: string[] } | null;
  title: string;
  projectId?: string;
  document: LyricDocument;
  apply: (command: LyricCommand) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  dirty: boolean;
  saving?: boolean;
  error?: string | null;
  outputIssues?: OutputIssue[];
  onSave: () => void;
  onNew?: () => void;
  onImportName?: (name: string) => void;
  onExportFormat?: (format: LyricFormat) => void;
  saveForPackaging?: () => Promise<{ revision: string; document: LyricDocument } | undefined>;
  selectedLineId?: string | null;
  playheadLineId?: string | null;
  onSelectLine?: (id: string) => void;
  onSelectUnit?: (lineId: string, wordId: string | null, rubyId: string | null) => void;
  onSelectRomanization?: (trackId: string, contentId: string) => void;
  transport?: RefObject<TransportHandle | null>;
  embedded?: boolean;
};

function isTextInput(target: EventTarget) {
  return target instanceof Element && Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
}

export function EditorWorkspace(props: Props) {
  const audioReview = useAudioReview();
  const { document, apply } = props;
  const searchConditions = useSearchConditions(props.projectId);
  const [acquisitionStore] = useState(() => new AcquisitionStore());
  useEffect(() => { acquisitionStore.activate(); return () => acquisitionStore.dispose(); }, [acquisitionStore]);
  const [selection, setSelection] = useState<EditorSelection | null>(null);
  const [syncTargetVersion, setSyncTargetVersion] = useState(0);
  const [clipboard, setClipboard] = useState<EditorClipboard | null>(null);
  const clipboardToken = useRef('');
  const pageRef = useRef<HTMLDivElement>(null);
  const wordInputs = useRef(new Map<string, HTMLInputElement>());
  const [mode, setMode] = useState<'audio' | 'acquire' | 'edit' | 'sync' | 'preview' | 'package' | 'auxiliary'>('edit');
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
  const [columns, setColumns] = useState(readColumnPreferences);
  const layoutRef = useRef<HTMLDivElement>(null);
  const outlineRef = useRef<HTMLElement>(null), inspectorRef = useRef<HTMLElement>(null), mainRef = useRef<HTMLElement>(null);
  const [layoutWidth, setLayoutWidth] = useState(1280);
  useEffect(() => {
    const element = layoutRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setLayoutWidth(element.clientWidth));
    observer.observe(element); return () => observer.disconnect();
  }, [mode]);
  const commitColumns = (next: ColumnPreferences) => { setColumns(next); localStorage.setItem(COLUMN_STORAGE, JSON.stringify(next)); };
  const toggleColumn = (side: ColumnSide) => {
    const pane = side === 'outline' ? outlineRef.current : inspectorRef.current;
    if (pane?.contains(pane.ownerDocument.activeElement)) mainRef.current?.focus();
    commitColumns({ ...columns, [`${side}Visible`]: !columns[`${side}Visible`] });
  };
  const layoutColumns = mode === 'audio' ? { ...columns, inspectorVisible: false } : columns;
  const rendered = renderedColumns(layoutColumns, layoutWidth);
  const template = (sizes: { outline: number; inspector: number }) => `${columns.outlineVisible ? `${sizes.outline}px 6px ` : ''}minmax(0, 1fr)${layoutColumns.inspectorVisible ? ` 6px ${sizes.inspector}px` : ''}`;
  const separator = (side: ColumnSide) => {
    const other = side === 'outline' ? 'inspector' : 'outline';
    const maximum = Math.max(COLUMN_LIMITS[side].min, Math.min(COLUMN_LIMITS[side].max, layoutWidth - rendered[other] - (Number(columns.outlineVisible) + Number(layoutColumns.inspectorVisible)) * 6 - 480));
    return <ColumnSeparator side={side} width={rendered[side]} preferredWidth={columns[`${side}Width`]} maximum={maximum}
      onChange={width => {
        // Preview geometry directly; keep the 2000-row editor out of pointermove renders.
        const preview = renderedColumns({ ...layoutColumns, [`${side}Width`]: width }, layoutWidth);
        layoutRef.current!.style.gridTemplateColumns = template(preview);
        return preview[side];
      }}
      onCommit={width => commitColumns({ ...columns, [`${side}Width`]: width })} />;
  };
  const [settingsDialog, setSettingsDialog] = useState<'metadata' | 'singers' | 'tracks' | null>(null);
  const [message, setMessage] = useState('');
  const [segmentationOpen, setSegmentationOpen] = useState(false);
  const [batchToolsOpen, setBatchToolsOpen] = useState(false);
  const [rubyShortcut, setRubyShortcut] = useState<{ wordId: string; serial: number; afterRubyId?: string | null } | null>(null);
  const rubyShortcutSerial = useRef(0);
  const [splitLineId, setSplitLineId] = useState<string | null>(null);
  const [contentTransfer, setContentTransfer] = useState<{ trackId: string; contentId: string; targetLineId: string } | null>(null);
  const [romanizationGeneration, setRomanizationGeneration] = useState<string[] | null>(null);
  const [rubyGeneration, setRubyGeneration] = useState<{ lineIds: string[]; trackId?: string; contentId?: string } | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; title: string; actions: ContextAction[]; target: HTMLElement } | null>(null);
  const [locate, setLocate] = useState<{ id: string; serial: number; focus?: string } | null>(null);
  const locateSerial = useRef(0);
  const requestLocate = (id: string, focus?: string) => setLocate({ id, focus, serial: ++locateSerial.current });
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
        const track = document.romanizationTracks.find((item) => item.id === current.trackId);
        const content = track?.contents.find((item) => item.id === current.contentId);
        if (!track || !content) return null;
        if (current.kind === 'romanization-content') {
          const ids = current.ids.filter((id) => track.contents.some((item) => item.id === id && item.lineId === content.lineId));
          return ids.length === current.ids.length && current.lineId === content.lineId ? current
            : { ...current, lineId: content.lineId, ids, anchorId: ids.includes(current.anchorId) ? current.anchorId : ids[0] ?? '', activeId: ids.includes(current.activeId) ? current.activeId : ids.at(-1) ?? '' };
        }
        if (content.kind !== 'timed') return null;
        const ids = current.ids.filter((id) => content.units.some((unit) => unit.id === id));
        return ids.length ? { ...current, lineId: content.lineId, ids, anchorId: ids.includes(current.anchorId) ? current.anchorId : ids[0], activeId: ids.includes(current.activeId) ? current.activeId : ids.at(-1)! }
          : { kind: 'romanization-content', lineId: content.lineId, trackId: current.trackId, contentId: content.id, ids: [content.id], anchorId: content.id, activeId: content.id };
      }
      if (current.kind === 'ruby') {
        const line = document.lines.find((item) => item.id === current.lineId);
        const word = line?.words.find((item) => item.id === current.wordId);
        if (!word) return null;
        const ids = current.ids.filter((id) => word.rubyUnits.some((unit) => unit.id === id));
        return ids.length ? { ...current, ids, anchorId: ids.includes(current.anchorId) ? current.anchorId : ids[0], activeId: ids.includes(current.activeId) ? current.activeId : ids.at(-1)! }
          : { kind: 'words', lineId: line!.id, ids: [word.id], anchorId: word.id, activeId: word.id };
      }
      const order = document.lines.flatMap((line) => line.words.map((word) => word.id));
      const ids = current.ids.filter((id) => order.includes(id));
      const activeId = order.includes(current.activeId) ? current.activeId : ids.at(-1) ?? '';
      const activeLine = document.lines.find((line) => line.words.some((word) => word.id === activeId));
      if (activeLine && ids.length === current.ids.length && current.lineId === activeLine.id) return current;
      return activeLine ? { ...current, lineId: activeLine.id, ids, anchorId: order.includes(current.anchorId) ? current.anchorId : ids[0] ?? '', activeId }
        : { kind: 'lines', ids: [], anchorId: '', activeId: '' };
    });
  }, [document]);
  const activeLineId = selectionLineId(selection) ?? props.selectedLineId;
  const selectedLine = document.lines.find((line) => line.id === activeLineId) ?? document.lines[0];
  // The active canvas selection is the single source of the timing target.
  const syncCursor = syncUnits(document).find(unit => {
    if (!selection) return unit.lineId === selectedLine?.id;
    if (selection.kind === 'lines') return unit.lineId === selection.activeId;
    if (selection.kind === 'words') return unit.wordId === selection.activeId;
    if (selection.kind === 'ruby') return unit.wordId === selection.wordId && unit.rubyUnitId === selection.activeId;
    return false;
  }) ?? null;
  const mainLines = document.lines.filter((line) => !line.backgroundOf);
  const ordinalById = visibleLineOrdinals(document);
  const mainIds = mainLines.map((line) => line.id);
  const occupiedParents = new Set(document.lines.filter(line => line.backgroundOf && line.id !== selectedLine?.id).map(line => line.backgroundOf));
  const selectedMainLines = selectedLine?.backgroundOf ? [] : selection?.kind === 'lines' && selection.ids.length
    ? mainLines.filter((line) => selection.ids.includes(line.id))
    : selectedLine && !selectedLine.backgroundOf ? [selectedLine] : [];
  const selectedWordLineIndexes = selection?.kind === 'words'
    ? document.lines.flatMap((line, index) => line.words.some((word) => selection.ids.includes(word.id)) ? [index] : []) : [];
  const selectLine = (line: LyricLine, shift = false, toggle = false) => {
    setSyncTargetVersion(value => value + 1);
    const id = line.backgroundOf ?? line.id;
    const previous = selection?.kind === 'lines' ? selection : null;
    const ids = selectIds(mainIds, previous?.ids ?? [], previous?.anchorId ?? id, id, shift, toggle);
    setSelection({ kind: 'lines', ids, anchorId: shift || toggle ? previous?.anchorId ?? id : id, activeId: line.id });
    props.onSelectLine?.(line.id);
    props.onSelectUnit?.(line.id, null, null);
  };
  const selectWord = (line: LyricLine, word: LyricWord, shift = false, toggle = false) => {
    setSyncTargetVersion(value => value + 1);
    const previous = selection?.kind === 'words' ? selection : null;
    const order = document.lines.flatMap((item) => item.words.map((value) => value.id));
    const ids = selectIds(order, previous?.ids ?? [], previous?.anchorId ?? word.id, word.id, shift, toggle);
    setSelection({ kind: 'words', lineId: line.id, ids, anchorId: shift || toggle ? previous?.anchorId ?? word.id : word.id, activeId: word.id });
    props.onSelectLine?.(line.id);
    props.onSelectUnit?.(line.id, word.id, null);
  };
  const selectRuby = (line: LyricLine, word: LyricWord, rubyId: string, shift = false, toggle = false) => {
    setSyncTargetVersion(value => value + 1);
    const previous = selection?.kind === 'ruby' && selection.wordId === word.id ? selection : null;
    const order = word.rubyUnits.map((unit) => unit.id);
    const ids = selectIds(order, previous?.ids ?? [], previous?.anchorId ?? rubyId, rubyId, shift, toggle);
    setSelection({ kind: 'ruby', lineId: line.id, wordId: word.id, ids, anchorId: shift || toggle ? previous?.anchorId ?? rubyId : rubyId, activeId: rubyId });
    props.onSelectLine?.(line.id);
    props.onSelectUnit?.(line.id, word.id, rubyId);
  };
  const selectRomanizationContent = (lineId: string, trackId: string, contentId: string, shift = false, toggle = false) => {
    setSyncTargetVersion(value => value + 1);
    const previous = selection?.kind === 'romanization-content' && selection.trackId === trackId && selection.lineId === lineId ? selection : null;
    const order = document.romanizationTracks.find((track) => track.id === trackId)?.contents.filter((content) => content.lineId === lineId).map((content) => content.id) ?? [];
    const ids = selectIds(order, previous?.ids ?? [], previous?.anchorId ?? contentId, contentId, shift, toggle);
    setSelection({ kind: 'romanization-content', lineId, trackId, contentId, ids, anchorId: shift || toggle ? previous?.anchorId ?? contentId : contentId, activeId: contentId });
    props.onSelectLine?.(lineId);
    props.onSelectRomanization?.(trackId, contentId);
  };
  const selectRomanizationUnit = (lineId: string, trackId: string, contentId: string, unitId: string, shift = false, toggle = false) => {
    setSyncTargetVersion(value => value + 1);
    const previous = selection?.kind === 'romanization-unit' && selection.contentId === contentId ? selection : null;
    const content = document.romanizationTracks.find((track) => track.id === trackId)?.contents.find((item) => item.id === contentId);
    const order = content?.kind === 'timed' ? content.units.map((unit) => unit.id) : [];
    const ids = selectIds(order, previous?.ids ?? [], previous?.anchorId ?? unitId, unitId, shift, toggle);
    setSelection({ kind: 'romanization-unit', lineId, trackId, contentId, ids, anchorId: shift || toggle ? previous?.anchorId ?? unitId : unitId, activeId: unitId });
    props.onSelectLine?.(lineId);
    props.onSelectRomanization?.(trackId, contentId);
  };
  const [focusAgent,setFocusAgent] = useState<string>();
  const locateIssue = (issue: OutputIssue) => {
    if(issue.kind === 'agent') { setMode('edit'); setFocusAgent(issue.agentId); setSettingsDialog('singers'); return; }
    const line=document.lines.find(l=>l.id===issue.lineId);
    if(!line)return;
    setMode('edit');
    let focus=':scope';
    if(issue.kind==='word' || issue.kind==='ruby') {
      const word=line.words.find(w=>w.id===issue.wordId); if(!word)return;
      if(issue.rubyId) { selectRuby(line,word,issue.rubyId); focus=`[data-ruby-id="${CSS.escape(issue.rubyId)}"]`; }
      else { selectWord(line,word); focus=`[data-word-id="${CSS.escape(word.id)}"]`; }
    } else if(issue.kind==='romanization-unit') {
      selectRomanizationUnit(line.id,issue.trackId!,issue.contentId!,issue.unitId!);
      focus=`[data-romanization-unit-id="${CSS.escape(issue.unitId!)}"]`;
    } else if(issue.kind==='romanization-content') {
      selectRomanizationContent(line.id,issue.trackId!,issue.contentId!);
      focus=`[data-romanization-content-id="${CSS.escape(issue.contentId!)}"]`;
    } else selectLine(line);
    requestLocate(line.id,focus);
  };
  const assignmentIssues: OutputIssue[] = props.assignmentError ? props.assignmentError.objectIds.map(id=>{
    const line=document.lines.find(l=>l.id===props.assignmentError!.lineId);
    const base={lineId:props.assignmentError!.lineId,missing:[],message:props.assignmentError!.message} satisfies Omit<OutputIssue,'kind'>;
    const word=line?.words.find(w=>w.id===id||w.rubyUnits.some(u=>u.id===id)||w.alignmentUnits.some(u=>u.id===id));
    if(word){const ruby=word.rubyUnits.find(u=>u.id===id);return {...base,kind:ruby?'ruby':'word',wordId:word.id,...(ruby?{rubyId:ruby.id}:{})} as OutputIssue;}
    for(const track of document.romanizationTracks)for(const content of track.contents)if(content.lineId===line?.id&&content.kind==='timed'&&content.units.some(u=>u.id===id))return {...base,kind:'romanization-unit',trackId:track.id,contentId:content.id,unitId:id} as OutputIssue;
    return {...base,kind:'line'} as OutputIssue;
  }) : [];
  useEffect(()=>{
    if(!props.assignmentError)return;
    const paint=()=>{for(const id of props.assignmentError!.objectIds)for(const attr of ['data-line-id','data-word-id','data-ruby-id','data-romanization-unit-id','data-timeline-key'])globalThis.document.querySelectorAll(`[${attr}="${CSS.escape(id)}"]`).forEach(el=>el.setAttribute('data-assignment-error',''));};
    paint();const observer=new MutationObserver(paint);observer.observe(pageRef.current!,{childList:true,subtree:true});
    return()=>{observer.disconnect();globalThis.document.querySelectorAll('[data-assignment-error]').forEach(el=>el.removeAttribute('data-assignment-error'));};
  },[props.assignmentError,mode]);
  const dispatch = (command: LyricCommand) => {
    try { apply(command); setMessage(''); return true; }
    catch (error) { setMessage(error instanceof Error ? error.message : '编辑失败'); return false; }
  };
  const drag = useObjectDrag(document, pageRef, dispatch, setSelection);
  const displayed = drag.document;
  const currentSelection = (): EditorSelection | null => selection ?? (selectedLine ? { kind: 'lines', ids: [selectedLine.backgroundOf ?? selectedLine.id], anchorId: selectedLine.backgroundOf ?? selectedLine.id, activeId: selectedLine.id } : null);
  const copy = (target?: EditorSelection) => {
    const current = target ?? currentSelection();
    if (!current?.ids.length) return null;
    const next = copySelection(document, current);
    clipboardToken.current = crypto.randomUUID();
    setClipboard(next);
    setMessage('已复制到编辑器剪贴板');
    return next;
  };
  const cut = (target?: EditorSelection) => {
    const current = target ?? currentSelection();
    if (!current?.ids.length) return null;
    const next = copySelection(document, current);
    if (dispatch(cutSelection(document, current))) {
      setClipboard(next);
      clipboardToken.current = crypto.randomUUID();
      const available = current.kind !== 'lines' ? current.lineId : mainIds.filter((id) => !current.ids.includes(id)).at(-1);
      setSelection(available ? { kind: 'lines', ids: [available], anchorId: available, activeId: available } : { kind: 'lines', ids: [], anchorId: '', activeId: '' });
      mainRef.current?.focus({ preventScroll: true });
      return next;
    }
    return null;
  };
  const removeSelection = (current = selection) => {
    if (!current?.ids.length) return;
    if (dispatch(deleteSelection(document, current))) {
      const available = current.kind === 'lines' ? mainIds.find(id => !current.ids.includes(id)) : current.lineId;
      setSelection(available ? { kind: 'lines', ids: [available], anchorId: available, activeId: available } : null);
      mainRef.current?.focus({ preventScroll: true });
    }
  };
  const paste = (next: EditorClipboard | null, plain?: string, target?: EditorSelection) => {
    if (!next && !plain) return;
    try {
      const result = next ? pasteRich(document, next, target ?? currentSelection()) : pastePlain(document, plain!, target ?? currentSelection());
      if (dispatch(result.command)) setSelection(result.selection);
    } catch (error) { setMessage(error instanceof Error ? error.message : '粘贴失败'); }
  };
  const selectAll = (invert: boolean) => {
    if (selection?.kind === 'ruby') {
      const order = document.lines.find((line) => line.id === selection.lineId)?.words.find((word) => word.id === selection.wordId)?.rubyUnits.map((unit) => unit.id) ?? [];
      const ids = invert ? invertIds(order, selection.ids) : order;
      setSelection({ ...selection, ids, anchorId: ids[0] ?? '', activeId: ids.at(-1) ?? '' });
    } else if (selection?.kind === 'romanization-unit') {
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
        setSelection({ ...selection, lineId: target.id });
        props.onSelectLine?.(target.id);
      }
    } catch (error) { setMessage(error instanceof Error ? error.message : '跨行移动失败'); }
  };
  const pointerSource = (element: Element): DragSource | null => {
    const lineId = element.closest<HTMLElement>('[data-line-id]')?.dataset.lineId;
    if (!lineId) return null;
    const romanContentId = element.closest<HTMLElement>('[data-romanization-content-id]')?.dataset.romanizationContentId;
    const romanUnitId = element.closest<HTMLElement>('[data-romanization-unit-id]')?.dataset.romanizationUnitId;
    if (romanContentId) {
      const track = document.romanizationTracks.find((item) => item.contents.some((content) => content.id === romanContentId));
      if (!track) return null;
      return romanUnitId ? { kind: 'romanization-unit', lineId, trackId: track.id, contentId: romanContentId, unitId: romanUnitId }
        : { kind: 'romanization-content', lineId, trackId: track.id, contentId: romanContentId };
    }
    const wordId = element.closest<HTMLElement>('[data-word-id]')?.dataset.wordId;
    const rubyId = element.closest<HTMLElement>('[data-ruby-id]')?.dataset.rubyId;
    if (rubyId && wordId) return { kind: 'ruby', lineId, wordId, rubyId };
    if (wordId) return { kind: 'word', lineId, wordId };
    const line = document.lines.find((item) => item.id === lineId);
    return { kind: 'line', lineId: line?.backgroundOf ?? lineId };
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
  const openContext = (target: HTMLElement, x: number, y: number) => {
    const rubyId = target.closest<HTMLElement>('[data-ruby-id]')?.dataset.rubyId;
    const romanUnitId = target.closest<HTMLElement>('[data-romanization-unit-id]')?.dataset.romanizationUnitId;
    const romanContentId = target.closest<HTMLElement>('[data-romanization-content-id]')?.dataset.romanizationContentId;
    const wordId = target.closest<HTMLElement>('[data-word-id]')?.dataset.wordId;
    const lineId = target.closest<HTMLElement>('[data-line-id]')?.dataset.lineId;
    const line = document.lines.find((item) => item.id === lineId);
    if (!line) return false;
    const word = line.words.find((item) => item.id === wordId);
    let effective: EditorSelection;
    let title = '歌词行';
    let actions: ContextAction[] = [];
    if (rubyId && word) {
      const index = word.rubyUnits.findIndex((unit) => unit.id === rubyId);
      const unit = word.rubyUnits[index];
      if (!unit) return false;
      effective = selection?.kind === 'ruby' && selection.wordId === word.id && selection.ids.includes(rubyId) ? { ...selection, activeId: rubyId }
        : { kind: 'ruby', lineId: line.id, wordId: word.id, ids: [rubyId], anchorId: rubyId, activeId: rubyId };
      title = '注音 操作';
      actions = [
        { label: '添加读音', run: () => { setRubyShortcut({ wordId: word.id, afterRubyId: rubyId, serial: ++rubyShortcutSerial.current }); } },
        { label: '拆分读音', disabled: Array.from(unit.reading).length < 2, run: () => dispatch({ type: 'split-ruby', lineId: line.id, wordId: word.id, rubyId, at: Math.floor(Array.from(unit.reading).length / 2) }) },
        { label: '合并前一读音', disabled: index === 0, run: () => dispatch({ type: 'merge-ruby', lineId: line.id, wordId: word.id, firstRubyId: word.rubyUnits[index - 1].id, secondRubyId: rubyId }) },
        { label: '向前移动', disabled: index === 0, run: () => dispatch({ type: 'move-ruby', lineId: line.id, wordId: word.id, rubyId, afterRubyId: word.rubyUnits[index - 2]?.id ?? null }) },
        { label: '向后移动', disabled: index === word.rubyUnits.length - 1, run: () => dispatch({ type: 'move-ruby', lineId: line.id, wordId: word.id, rubyId, afterRubyId: word.rubyUnits[index + 1].id }) },
        { label: '按音拍拆分', disabled: splitReadingMora(unit.reading).length < 2, run: () => {
          if (word.alignmentUnits.some((item) => item.rubyUnitId)) { setMessage('带对齐结果的读音不能自动拆分'); return; }
          const parts = splitReadingMora(unit.reading).map((reading, partIndex) => ({ ...unit, id: partIndex ? crypto.randomUUID() : unit.id, reading }));
          const distributed = distributeRubyTime({ ...word, beginMs: unit.beginMs, endMs: unit.endMs }, parts);
          dispatch({ type: 'set-ruby-units', lineId: line.id, wordId: word.id, units: word.rubyUnits.flatMap((item) => item.id === unit.id ? distributed : [item]), overwrite: true });
        } },
        { label: '重分配读音时间', run: () => dispatch({ type: 'redistribute-ruby-time', lineId: line.id, wordId: word.id }) },
        { label: effective.ids.length > 1 ? `删除所选读音（${effective.ids.length}）` : '删除读音', run: () => removeSelection(effective) },
      ];
    } else if (romanContentId) {
      const track = document.romanizationTracks.find((item) => item.contents.some((content) => content.id === romanContentId));
      const content = track?.contents.find((item) => item.id === romanContentId);
      if (!track || !content) return false;
      if (romanUnitId && content.kind === 'timed') {
        const index = content.units.findIndex((unit) => unit.id === romanUnitId);
        const unit = content.units[index];
        if (!unit) return false;
        effective = selection?.kind === 'romanization-unit' && selection.contentId === content.id && selection.ids.includes(unit.id) ? { ...selection, activeId: unit.id }
          : { kind: 'romanization-unit', lineId: line.id, trackId: track.id, contentId: content.id, ids: [unit.id], anchorId: unit.id, activeId: unit.id };
        title = '音译单元操作';
        actions = [
          { label: '拆分单元', disabled: Array.from(unit.text).length < 2, run: () => dispatch({ type: 'split-romanization-unit', trackId: track.id, contentId: content.id, unitId: unit.id, at: Math.floor(Array.from(unit.text).length / 2) }) },
          { label: '合并前一单元', disabled: index === 0, run: () => dispatch({ type: 'merge-romanization-units', trackId: track.id, contentId: content.id, firstUnitId: content.units[index - 1].id, secondUnitId: unit.id }) },
          { label: '向前移动', disabled: index === 0, run: () => dispatch({ type: 'move-romanization-unit', trackId: track.id, contentId: content.id, unitId: unit.id, afterUnitId: content.units[index - 2]?.id ?? null }) },
          { label: '向后移动', disabled: index === content.units.length - 1, run: () => dispatch({ type: 'move-romanization-unit', trackId: track.id, contentId: content.id, unitId: unit.id, afterUnitId: content.units[index + 1].id }) },
          { label: effective.ids.length > 1 ? `删除所选单元（${effective.ids.length}）` : '删除单元', run: () => removeSelection(effective) },
        ];
      } else {
        effective = selection?.kind === 'romanization-content' && selection.trackId === track.id && selection.ids.includes(content.id) ? { ...selection, activeId: content.id, contentId: content.id }
          : { kind: 'romanization-content', lineId: line.id, trackId: track.id, contentId: content.id, ids: [content.id], anchorId: content.id, activeId: content.id };
        title = '音译内容操作';
        const siblings = track.contents.filter((item) => item.lineId === line.id);
        const siblingIndex = siblings.findIndex((item) => item.id === content.id);
        const previousGlobal = siblingIndex > 0 ? track.contents.findIndex((item) => item.id === siblings[siblingIndex - 1].id) : -1;
        actions = [
          { label: '分词并定时', disabled: content.kind === 'timed', run: () => { if (content.kind === 'plain') dispatch({ type: 'set-romanization-content', trackId: track.id, content: { ...content, kind: 'timed', units: (content.text.match(/\S+\s*|\s+/gu) ?? []).map((text) => ({ id: crypto.randomUUID(), text, beginMs: null, endMs: null })) } }); } },
          { label: '音译内容前移', disabled: siblingIndex === 0, run: () => dispatch({ type: 'move-romanization-content', trackId: track.id, contentId: content.id, lineId: line.id, afterContentId: track.contents[previousGlobal - 1]?.id ?? null }) },
          { label: '音译内容后移', disabled: siblingIndex === siblings.length - 1, run: () => dispatch({ type: 'move-romanization-content', trackId: track.id, contentId: content.id, lineId: line.id, afterContentId: siblings[siblingIndex + 1].id }) },
          { label: '转移到其他主行…', disabled: mainLines.length < 2, run: () => setContentTransfer({ trackId: track.id, contentId: content.id, targetLineId: mainLines.find((item) => item.id !== line.id)?.id ?? '' }) },
          { label: effective.ids.length > 1 ? `删除所选内容（${effective.ids.length}）` : '删除内容', run: () => removeSelection(effective) },
          { label: '从音译生成 注音…', run: () => setRubyGeneration({ lineIds: [line.id], trackId: track.id, contentId: content.id }) },
          { label: '管理轨道…', run: () => setSettingsDialog('tracks') },
          { label: '轨道前移', run: () => dispatch({ type: 'move-romanization-track', trackId: track.id, direction: -1 }) },
          { label: '轨道后移', run: () => dispatch({ type: 'move-romanization-track', trackId: track.id, direction: 1 }) },
        ];
      }
    } else if (word) {
      const index = line.words.findIndex((item) => item.id === word.id);
      effective = selection?.kind === 'words' && selection.ids.includes(word.id) ? { ...selection, lineId: line.id, activeId: word.id }
        : { kind: 'words', lineId: line.id, ids: [word.id], anchorId: word.id, activeId: word.id };
      title = '词操作';
      actions = [
        { label: '前插词', run: () => dispatch({ type: 'insert-word', lineId: line.id, afterWordId: line.words[index - 1]?.id ?? null, word: createWord('新词') }) },
        { label: '后插词', run: () => dispatch({ type: 'insert-word', lineId: line.id, afterWordId: word.id, word: createWord('新词') }) },
        { label: '拆分词', disabled: Array.from(word.text).length < 2, run: () => {
          try {
            const parts = segmentText(word.text, DEFAULT_SEGMENT_OPTIONS);
            if (parts.length < 2) { setSegmentationOpen(true); return; }
            dispatch({ type: 'segment-words', changes: [{ lineId: line.id, wordId: word.id, words: distributeSegmentTime(word, parts, DEFAULT_SEGMENT_OPTIONS.punctuationWeight) }] });
          } catch (cause) { setMessage((cause as Error).message); }
        } },
        { label: '合并前一词', disabled: index === 0, run: () => dispatch({ type: 'merge-words', lineId: line.id, firstWordId: line.words[index - 1].id, secondWordId: word.id }) },
        { label: '词前移', disabled: index === 0, run: () => moveWord(line, word, -1) },
        { label: '词后移', disabled: index === line.words.length - 1, run: () => moveWord(line, word, 1) },
        { label: '移到上一行', disabled: document.lines[document.lines.indexOf(line) - 1] === undefined, run: () => {
          const target = document.lines[document.lines.indexOf(line) - 1];
          if (target) dispatch(moveWordsAcrossLine(document, effective as Extract<EditorSelection, { kind: 'words' }>, target.id));
        } },
        { label: '移到下一行', disabled: document.lines[document.lines.indexOf(line) + 1] === undefined, run: () => {
          const target = document.lines[document.lines.indexOf(line) + 1];
          if (target) dispatch(moveWordsAcrossLine(document, effective as Extract<EditorSelection, { kind: 'words' }>, target.id));
        } },
        { label: '添加注音', run: () => { setRubyShortcut({ wordId: word.id, serial: ++rubyShortcutSerial.current }); } },
        { label: '重分配读音时间', disabled: word.rubyUnits.length === 0, run: () => dispatch({ type: 'redistribute-ruby-time', lineId: line.id, wordId: word.id }) },
        { label: effective.ids.length > 1 ? `删除所选词（${effective.ids.length}）` : '删除词', run: () => removeSelection(effective) },
      ];
    } else {
      const id = line.backgroundOf ?? line.id;
      effective = selection?.kind === 'lines' && selection.ids.includes(id) ? { ...selection, activeId: line.id }
        : { kind: 'lines', ids: [id], anchorId: id, activeId: line.id };
      title = '歌词行操作';
      actions = [
        { label: '前插行', run: () => { const index = mainLines.findIndex((item) => item.id === id); dispatch({ type: 'insert-line', afterLineId: mainLines[index - 1]?.id ?? null }); } },
        { label: '后插行', run: () => dispatch({ type: 'insert-line', afterLineId: id }) },
        ...(!line.backgroundOf && document.romanizationTracks.some(track => track.contents.some(content => content.lineId === line.id))
          ? [{ label: '从音译生成 注音…', run: () => setRubyGeneration({ lineIds: effective.ids.filter(id => mainIds.includes(id)) }) }] : []),
        ...(!line.backgroundOf ? [{ label: '生成日文罗马字音译…', run: () => setRomanizationGeneration(effective.ids.filter(id => mainIds.includes(id))) }] : []),
        { label: '添加词', run: () => dispatch({ type: 'insert-word', lineId: line.id, afterWordId: line.words.at(-1)?.id ?? null, word: createWord('新词') }) },
        { label: '行上移', disabled: Boolean(line.backgroundOf) || mainLines[0]?.id === line.id, run: () => moveLine(line, -1) },
        { label: '行下移', disabled: Boolean(line.backgroundOf) || mainLines.at(-1)?.id === line.id, run: () => moveLine(line, 1) },
        { label: '拆分行…', disabled: Boolean(line.backgroundOf) || line.words.length < 2, run: () => { const issues = lineStructureIssues(document, line); if (issues.length) setMessage(issues.join('；')); else setSplitLineId(line.id); } },
        { label: '合并下一行', disabled: Boolean(line.backgroundOf) || mainLines.at(-1)?.id === line.id, run: () => {
          const next = mainLines[mainLines.findIndex((item) => item.id === line.id) + 1];
          if (next) dispatch({ type: 'merge-lines', firstLineId: line.id, secondLineId: next.id });
        } },
        { label: '分词…', run: () => setSegmentationOpen(true) },
        { label: effective.ids.length > 1 ? `删除所选行（${effective.ids.length}）` : '删除行', run: () => removeSelection(effective) },
      ];
    }
    const shared: ContextAction[] = [
      { label: '复制', run: () => { copy(effective); } },
      { label: '剪切', run: () => { cut(effective); } },
      { label: '粘贴', disabled: !clipboard, run: () => paste(clipboard, undefined, effective) },
    ];
    setSelection(effective);
    props.onSelectLine?.(line.id);
    if (effective.kind === 'romanization-content' || effective.kind === 'romanization-unit') props.onSelectRomanization?.(effective.trackId, effective.contentId);
    setContextMenu({ x, y, title, actions: [...shared, ...actions], target: target.closest<HTMLElement>('[data-ruby-id], [data-romanization-unit-id], [data-romanization-content-id], [data-word-id], [data-line-id]') ?? target });
    return true;
  };
  const ownsClipboard = (target: EventTarget) => {
    if ((mode !== 'edit' && mode !== 'sync') || !selection?.ids.length || isTextInput(target)) return false;
    if (!(target instanceof Element) || target.closest('[role="dialog"], [role="menu"]')) return false;
    if (window.getSelection()?.toString()) return false;
    return Boolean(outlineRef.current?.contains(target) || mainRef.current?.contains(target));
  };
  const closeContext = () => { const target = contextMenu?.target; setContextMenu(null); if (target?.isConnected) target.focus(); else mainRef.current?.focus(); };
  const navigateWord = (wordId: string, direction: -1 | 1) => {
    const order = document.lines.flatMap((line) => line.words.map((word) => ({ lineId: line.id, wordId: word.id })));
    const target = order[order.findIndex((item) => item.wordId === wordId) + direction];
    if (!target) return;
    const line = document.lines.find(line => line.id === target.lineId)!;
    selectWord(line, line.words.find(word => word.id === target.wordId)!);
    const input = wordInputs.current.get(target.wordId);
    if (input) input.focus();
    else {
      pendingFocus.current = target.wordId;
      requestLocate(target.lineId);
    }
  };
  const wordView = (line: LyricLine, word: LyricWord) => <LyricWordView key={word.id} id={word.id} placeholder={drag.isPlaceholder('word', word.id)}
    selected={selection?.kind === 'words' && selection.ids.includes(word.id)}
    onSelect={(shift, toggle) => selectWord(line, word, shift, toggle)}>
    <RubyWordEditor lineId={line.id} word={word} placeholderIds={drag.placeholders?.kind === 'ruby' ? drag.placeholders.ids : undefined} selectedRubyIds={selection?.kind === 'ruby' && selection.wordId === word.id ? selection.ids : []}
      onSelectRuby={(rubyId, shift, toggle) => selectRuby(line, word, rubyId, shift, toggle)} apply={dispatch}
      requestAddSerial={rubyShortcut?.wordId === word.id ? rubyShortcut.serial : undefined} requestAfterRubyId={rubyShortcut?.wordId === word.id ? rubyShortcut.afterRubyId : undefined} />
    <div className={styles.wordMain}>
      <DraftInput value={word.text} label={`词 ${word.text}`} onFocus={() => selectWord(line, word)}
        onCommit={(text) => {
          const shortcut = text.endsWith('|');
          const next = shortcut ? text.slice(0, -1) : text;
          if (!next) { setMessage('注音 快捷输入需要正文'); return; }
          if ((next === word.text || dispatch({ type: 'edit-word', lineId: line.id, wordId: word.id, text: next })) && shortcut) setRubyShortcut({ wordId: word.id, serial: ++rubyShortcutSerial.current });
        }}
        onSplit={(at, draft) => dispatch({ type: 'batch', commands: [
          { type: 'edit-word', lineId: line.id, wordId: word.id, text: draft },
          { type: 'split-word', lineId: line.id, wordId: word.id, at: utf16ToCodePoint(draft, at) },
        ] })}
        onMove={(direction) => moveWord(line, word, direction)} onNavigate={(direction) => navigateWord(word.id, direction)}
        inputRef={(node) => { if (node) { wordInputs.current.set(word.id, node); if (pendingFocus.current === word.id) { pendingFocus.current = null; node.focus(); } } else wordInputs.current.delete(word.id); }} />
    </div>
    <TimePair begin={word.beginMs} end={word.endMs} label={`词 ${word.text}`} onCommit={(beginMs, endMs) => dispatch({ type: 'set-word-time', lineId: line.id, wordId: word.id, beginMs, endMs })} />
    <label className={styles.emptyBeat}>空拍 <input type="number" min="0" max="32" aria-label={`词 ${word.text}空拍数`} value={word.emptyBeat} onChange={(event) => dispatch({ type: 'set-word-empty-beat', lineId: line.id, wordId: word.id, emptyBeat: Number(event.target.value) })} /></label>
  </LyricWordView>;
  return <div ref={pageRef} className={`${styles.page} ${props.embedded ? styles.embeddedPage : ''}`}
    onPointerDownCapture={() => { pageRef.current!.dataset.pointerFocus = ''; }}
    onKeyDownCapture={() => { delete pageRef.current!.dataset.pointerFocus; }}
    onPointerDown={(event) => {
      if (mode !== 'edit' || event.pointerType !== 'mouse' || event.button !== 0 || event.shiftKey) return;
      const element = event.target as Element;
      if (element.closest('input,select,textarea,a,[contenteditable="true"],[role="menu"]') || element.closest('button') && !element.closest('[data-outline-drag]')) return;
      const source = pointerSource(element);
      if (!source) return;
      event.preventDefault();
      const node = element.closest<HTMLElement>('[data-ruby-id], [data-romanization-unit-id], [data-romanization-content-id], [data-word-id], [data-line-id]')!;
      (element.closest<HTMLElement>('[data-outline-drag]') ?? node).focus({ preventScroll: true });
      const line = document.lines.find(line => line.id === source.lineId)!;
      const toggle = event.ctrlKey || event.metaKey;
      if (source.kind === 'line') {
        const clicked = document.lines.find(item => item.id === node.dataset.lineId)!;
        selectLine(clicked, false, toggle); if (element.closest('[data-outline-drag]')) requestLocate(clicked.id);
      }
      else if (source.kind === 'word') selectWord(line, line.words.find(word => word.id === source.wordId)!, false, toggle);
      else if (source.kind === 'ruby') selectRuby(line, line.words.find(word => word.id === source.wordId)!, source.rubyId, false, toggle);
      else if (source.kind === 'romanization-content') selectRomanizationContent(line.id, source.trackId, source.contentId, false, toggle);
      else selectRomanizationUnit(line.id, source.trackId, source.contentId, source.unitId, false, toggle);
      drag.start(source, node, event.pointerId, event.clientX, event.clientY, event.altKey || event.ctrlKey && !event.metaKey);
    }}
    onPointerMove={(event) => {
      if (!drag.active()) return;
      event.preventDefault();
      drag.move(event.pointerId, event.clientX, event.clientY, event.altKey || event.ctrlKey && !event.metaKey);
    }}
    onPointerUp={() => { if (drag.active()) drag.finish(); }}
    onPointerCancel={drag.cancel}
    onLostPointerCapture={() => { if (drag.active()) drag.cancel(); }}
    onClickCapture={(event) => { if (drag.suppressClick.current) { drag.suppressClick.current = false; event.preventDefault(); event.stopPropagation(); } }}
    onContextMenu={(event: ReactMouseEvent<HTMLDivElement>) => {
    if (isTextInput(event.target)) return;
    if (openContext(event.target as HTMLElement, event.clientX, event.clientY)) event.preventDefault();
  }} onCopy={(event) => {
    if (!ownsClipboard(event.target)) return;
    const item = copy();
    if (item) { event.clipboardData.setData('text/plain', item.text); event.clipboardData.setData(CLIPBOARD_MIME, clipboardToken.current); event.preventDefault(); }
  }} onCut={(event) => {
    if (!ownsClipboard(event.target)) return;
    const item = cut();
    if (item) { event.clipboardData.setData('text/plain', item.text); event.clipboardData.setData(CLIPBOARD_MIME, clipboardToken.current); event.preventDefault(); }
  }} onPaste={(event) => {
    if (!ownsClipboard(event.target)) return;
    const text = event.clipboardData.getData('text/plain');
    if (!text) return;
    event.preventDefault();
    paste(clipboard && event.clipboardData.getData(CLIPBOARD_MIME) === clipboardToken.current ? clipboard : null, text);
  }} onKeyDown={(event) => {
    if (event.key === 'Escape' && drag.active()) { drag.cancel(); event.preventDefault(); return; }
    if (event.nativeEvent.isComposing || (event.target instanceof Element && event.target.closest('[role="dialog"]'))) return;
    if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 's') {
      event.preventDefault();
      if (!props.saving) props.onSave();
      return;
    }
    if (isTextInput(event.target)) return;
    if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      // History may remove the focused object. Keep the next key in the editor.
      const focused = event.target as HTMLElement;
      requestAnimationFrame(() => {
        if (!focused.isConnected && window.document.activeElement === window.document.body) mainRef.current?.focus({ preventScroll: true });
      });
      if (event.shiftKey) { if (props.canRedo) props.redo(); }
      else if (props.canUndo) props.undo();
      return;
    }
    if (event.key === 'ContextMenu' || event.shiftKey && event.key === 'F10') {
      const target = event.target as HTMLElement;
      const rect = target.getBoundingClientRect();
      if (openContext(target, rect.left + 12, rect.bottom)) event.preventDefault();
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') { event.preventDefault(); selectAll(false); }
    if (event.key === 'Escape') { event.preventDefault(); setSelection({ kind: 'lines', ids: [], anchorId: '', activeId: '' }); }
  }}>
    <EditorMenu {...props} activeMenuId={activeMenuId} onMenuChange={setActiveMenuId} outlineVisible={columns.outlineVisible} inspectorVisible={columns.inspectorVisible} onToggleOutline={() => toggleColumn('outline')} onToggleInspector={() => toggleColumn('inspector')} />
    {(message || props.error) && <p role="alert" className={styles.error}>{message || props.error}</p>}
    <nav className={styles.modeTabs} aria-label="工作模式">{([['acquire','歌词获取'],['audio','音频处理'],['edit','编辑'],['sync','打轴'],['preview','预览'],['package','文件打包'],['auxiliary','项目辅助']] as const).map(([id,label]) => <button data-role="inline" key={id} aria-current={mode === id ? 'page' : undefined} onClick={() => { setMode(id); setActiveMenuId(null); }}>{label}</button>)}</nav>
    {props.projectId && props.project && props.applyProject && props.project.sourceAssetId && <VocalPanel visible={mode==='audio'} projectId={props.projectId} project={props.project} apply={props.applyProject} durationMs={props.audioDurationMs??0}/>}
    {mode === 'audio' && (props.projectId && props.project && props.applyProject && props.project.sourceAssetId ? <div ref={layoutRef} className={vocalStyles.audioLayout} style={{gridTemplateColumns:template(rendered)}}>
      {columns.outlineVisible && <aside ref={outlineRef} className={styles.outline} aria-label="音频处理大纲"><h2>大纲</h2><div className={styles.panelBody}>{document.lines.map(line => <div key={line.id} draggable onDragStart={e=>{selectLine(line);e.dataTransfer.setData(VOCAL_LINE_MIME,line.id);e.dataTransfer.effectAllowed="copy";const ghost=e.currentTarget.cloneNode(true) as HTMLElement;ghost.style.cssText="position:fixed;left:-10000px;opacity:.6;width:220px";window.document.body.appendChild(ghost);e.dataTransfer.setDragImage(ghost,20,16);setTimeout(()=>ghost.remove(),0);}}>
        <div onClick={() => selectLine(line)}><OutlineRow line={line} ordinal={ordinalById.get(line.backgroundOf ?? line.id)} selected={selectedLine?.id===line.id}/></div>
        {props.assignmentError?.lineId===line.id && <div role="alert" className={vocalStyles.error}>{props.assignmentError.message}{assignmentIssues.map((issue,i)=><button data-role="secondary" key={i} onClick={()=>locateIssue(issue)}>定位{issue.kind==='ruby'?'注音':issue.kind==='word'?'词':issue.kind==='romanization-unit'?'音译单元':'行'}{i+1}</button>)}</div>}
      </div>)}</div></aside>}
      {columns.outlineVisible && separator('outline')}
      <main ref={mainRef} tabIndex={-1} className={vocalStyles.main}><div ref={audioReview.setStatusHost}/><div hidden={!audioReview.timelineReady} className={vocalStyles.host} ref={props.onTimelineHost}/></main>
    </div> : <section className={styles.auxiliaryPlaceholder}><h1>人声分离与声学分析</h1><p>请先在项目列表上传音频并建立项目，再进行人声处理。当前本地歌词可继续编辑和导出。</p><a href="/projects">前往项目列表</a></section>)}
    {mode === 'acquire' && <LyricAcquisition store={acquisitionStore} searchConditions={searchConditions} document={document} apply={apply} onImported={() => setMode('edit')} onNew={props.onNew} onImportName={props.onImportName} />}
    {mode === 'package' && <PackagingPanel {...props} externalIssues={props.outputIssues} locateIssue={locateIssue} />}
    {mode === 'auxiliary' && <section className={styles.auxiliaryPlaceholder}><h1>项目辅助</h1><p>候选、任务、词典与审核流程将在后续阶段整理到此处。歌词文档与播放器保持当前状态。</p></section>}
    {mode === 'preview' && <Suspense fallback={<p>正在载入预览…</p>}><PreviewMode document={document} transport={props.transport} onSelectLine={props.onSelectLine} /></Suspense>}
    {mode === 'sync' && <SyncPanel preferenceScope={props.projectId ? `project:${props.projectId}` : `local:${props.title}`} document={document} cursor={syncCursor} targetVersion={syncTargetVersion} apply={dispatch} transport={props.transport}
      onCursor={(cursor) => { const line = document.lines.find((item) => item.id === cursor.lineId)!; const word = line.words.find((item) => item.id === cursor.wordId)!; if (cursor.rubyUnitId) selectRuby(line, word, cursor.rubyUnitId); else selectWord(line, word); requestLocate(line.id, cursor.rubyUnitId ? `[data-ruby-id="${cursor.rubyUnitId}"]` : `[data-word-id="${cursor.wordId}"]`); }} />}
    {mode === 'edit' && <EditorRibbon activeMenuId={activeMenuId} onMenuChange={setActiveMenuId} selection={selection} canPaste={Boolean(clipboard)}
      canMoveUp={selectedWordLineIndexes.length > 0 && selectedWordLineIndexes[0] > 0}
      canMoveDown={selectedWordLineIndexes.length > 0 && selectedWordLineIndexes.at(-1) !== document.lines.length - 1}
      copy={() => { copy(); }} cut={() => { cut(); }} remove={() => removeSelection()} paste={() => paste(clipboard)}
      selectAll={() => selectAll(false)} invertSelection={() => selectAll(true)}
      clearSelection={() => setSelection({ kind: 'lines', ids: [], anchorId: '', activeId: '' })}
      moveUp={() => moveSelectedWords(-1)} moveDown={() => moveSelectedWords(1)} openSegmentation={() => setSegmentationOpen(true)} openBatchTools={() => setBatchToolsOpen(true)}
      canGenerateRuby={selectedMainLines.some((line) => document.romanizationTracks.some((track) => track.contents.some((content) => content.lineId === line.id)))}
      canGenerateRomanization={selectedMainLines.length > 0} openRomanizationGeneration={() => setRomanizationGeneration(selectedMainLines.map(line => line.id))} openTracks={() => setSettingsDialog('tracks')} openMetadata={() => setSettingsDialog('metadata')} openSingers={() => setSettingsDialog('singers')} openRubyGeneration={() => setRubyGeneration({ lineIds: selectedMainLines.map((line) => line.id) })} />}
    {(mode === 'edit' || mode === 'sync') && <div ref={layoutRef} className={styles.layout} style={{ gridTemplateColumns: template(rendered) }}>{columns.outlineVisible && <aside ref={outlineRef} className={styles.outline} onClick={event => {
      const button = (event.target as Element).closest('[data-outline-drag]');
      if (!button) return;
      const line = document.lines.find(item => item.id === button.parentElement!.getAttribute('data-line-id'))!;
      selectLine(line, event.shiftKey, event.ctrlKey || event.metaKey); requestLocate(line.id);
    }}><h2>大纲</h2><div className={styles.panelBody}>
      {displayed.lines.map(line => <OutlineRow key={line.id} line={line} placeholder={drag.isPlaceholder('line', line.backgroundOf ?? line.id)} ordinal={ordinalById.get(line.backgroundOf ?? line.id)}
        selected={selection?.kind === 'lines' ? selection.ids.includes(line.backgroundOf ?? line.id) : selectedLine?.id === line.id} />)}
    </div></aside>}{columns.outlineVisible && separator('outline')}
      <main ref={mainRef} tabIndex={-1} className={styles.canvas}>
        <LyricList lines={displayed.lines} locate={locate} append={() => {
          const line = createLine('');
          if (dispatch({ type: 'insert-line', afterLineId: mainLines.at(-1)?.id ?? null, line })) {
            setSelection({ kind: 'lines', ids: [line.id], anchorId: line.id, activeId: line.id });
            props.onSelectLine?.(line.id); requestLocate(line.id);
          }
        }} renderLine={(line) => <LyricLineView key={line.id} line={line} placeholder={drag.isPlaceholder('line', line.backgroundOf ?? line.id)}
          selected={selection ? selection.kind === 'lines' ? selection.ids.includes(line.backgroundOf ?? line.id) : selection.kind === 'words' ? line.words.some((word) => selection.ids.includes(word.id)) : line.id === selection.lineId : selectedLine?.id === line.id}
          playhead={props.playheadLineId === line.id}
          onSelect={(shift, toggle) => selectLine(line, shift, toggle)} onMove={(direction) => moveLine(line, direction)}>
          <div className={styles.lineHeader}><span>L{ordinalById.get(line.backgroundOf ?? line.id)} · {line.backgroundOf ? '背景' : '主唱'}</span></div>
          <div className={styles.words}>{line.words.map((word) => wordView(line, word))}
            <InlineAdd label="添加词" commit={text => {
              const word = createWord(text);
              if (!dispatch({ type: 'insert-word', lineId: line.id, afterWordId: line.words.at(-1)?.id ?? null, word })) return false;
              setSelection({ kind: 'words', lineId: line.id, ids: [word.id], anchorId: word.id, activeId: word.id });
              props.onSelectLine?.(line.id); props.onSelectUnit?.(line.id, word.id, null); return true;
            }} />
          </div>
          {!line.backgroundOf && <TranslationEditor items={line.translations} apply={items => dispatch({ type: 'set-sublyrics', lineId: line.id, kind: 'translations', items })} />}
          {!line.backgroundOf && <div className={styles.romanizationTracks}>
            {displayed.romanizationTracks.map((track, trackIndex) => {
              const contents = track.contents.filter((content) => content.lineId === line.id);
              return <div key={track.id}>
                <div className={styles.romanizationTrackHeader}>
                  <span>L{ordinalById.get(line.id)} · 音译轨道 {trackIndex + 1} · {track.language ?? '未指定语言'}</span>
                  <button data-role="secondary" onClick={() => dispatch({ type: 'insert-romanization-content', trackId: track.id, content: { id: crypto.randomUUID(), lineId: line.id, kind: 'plain', text: '' } })}>添加音译</button>
                </div>
                {contents.map((content) => <RomanizationRow key={content.id} track={track} content={content}
                    placeholder={drag.isPlaceholder('romanization-content', content.id)} placeholderUnitIds={drag.placeholders?.kind === 'romanization-unit' ? drag.placeholders.ids : undefined}
                    selectedContent={selection?.kind === 'romanization-content' && selection.ids.includes(content.id)}
                    selectedUnitIds={selection?.kind === 'romanization-unit' && selection.contentId === content.id ? selection.ids : []}
                    selectContent={(shift, toggle) => selectRomanizationContent(line.id, track.id, content.id, shift, toggle)}
                    selectUnit={(unitId, shift, toggle) => selectRomanizationUnit(line.id, track.id, content.id, unitId, shift, toggle)} apply={dispatch} />)}
              </div>;
            })}
          </div>}
        </LyricLineView>} />
      </main>
      {columns.inspectorVisible && separator('inspector')}{columns.inspectorVisible && <aside ref={inspectorRef} className={styles.inspector}><h2>属性</h2><div className={styles.panelBody}>{selectedLine && <>
        <p>已选行：{selection?.kind === 'lines' && selection.ids.length > 1 ? `${selection.ids.length} 行` : `L${ordinalById.get(selectedLine.backgroundOf ?? selectedLine.id)}${selectedLine.backgroundOf ? ' · 背景' : ''}`}</p>
        {selection?.kind === 'lines' && selection.ids.length > 1 && <p className={styles.fieldContext}>当前行 L{ordinalById.get(selectedLine.backgroundOf ?? selectedLine.id)}</p>}
        <TimePair begin={selectedLine.beginMs} end={selectedLine.endMs} label={`行 ${selectedLine.id}`} onCommit={(beginMs, endMs) => dispatch({ type: 'set-line-time', lineId: selectedLine.id, beginMs, endMs })} />
        {selectedMainLines.length > 0 && <>
          <BooleanField label="跳过打轴" switchControl={!(selection?.kind === 'lines' && selection.ids.length > 1)} checked={selectedMainLines.every(line => line.ignoreSync)} mixed={selectedMainLines.some(line => line.ignoreSync) && !selectedMainLines.every(line => line.ignoreSync)} onChange={checked => dispatch({type:'batch', commands:selectedMainLines.map(line=>({type:'set-ignore-sync',lineId:line.id,ignoreSync:checked}))})}/>
          <SingerSelection agents={document.agents} lines={selectedMainLines} apply={dispatch} />
        </>}
        {selection?.kind !== 'lines' || selection.ids.length <= 1 ? <>
          <BooleanField label="背景歌词" switchControl checked={Boolean(selectedLine.backgroundOf)} onChange={(checked) => {
            if (!checked) { dispatch({ type: 'set-background-of', lineId: selectedLine.id, parentLineId: null }); return; }
            const index = document.lines.findIndex(line => line.id === selectedLine.id);
            const preceding = document.lines.slice(0, index).filter(line => !line.backgroundOf).at(-1);
            if (!preceding) { setMessage('此行之前没有主行，不能设为背景歌词'); return; }
            if (document.lines.some(line => line.backgroundOf === preceding.id)) { setMessage('前一主行已有背景歌词，请先处理所属关系'); return; }
            dispatch({ type: 'set-background-of', lineId: selectedLine.id, parentLineId: preceding.id });
          }} />
          <label>所属主行 <Select disabled={!selectedLine.backgroundOf} value={selectedLine.backgroundOf ?? ''} onChange={(event) => {
            if (selectedLine.backgroundOf) dispatch({ type: 'set-background-of', lineId: selectedLine.id, parentLineId: event.target.value });
          }}>
            <option value="">请选择</option>{mainLines.filter((line) => line.id !== selectedLine.id && !occupiedParents.has(line.id)).map((line) => <option key={line.id} value={line.id}>L{ordinalById.get(line.id)}</option>)}
          </Select></label>
          {selectedLine.backgroundOf && <p>歌手继承自所属主行：{document.lines.find((line) => line.id === selectedLine.backgroundOf)?.agentRefs.map((id) => document.agents.find((agent) => agent.id === id)?.name ?? id).join('、') || '未指定'}</p>}
        </> : null}
      </>}
      </div></aside>}</div>}
    {settingsDialog === 'metadata' && <SettingsDialog title="元数据编辑" close={() => setSettingsDialog(null)}><MetadataPanel document={document} apply={dispatch} /></SettingsDialog>}
    {settingsDialog === 'singers' && <SingerDialog focusAgent={focusAgent} document={document} apply={dispatch} close={() => setSettingsDialog(null)} />}
    {settingsDialog === 'tracks' && <SettingsDialog title="音译轨道管理" close={() => setSettingsDialog(null)}><div className={styles.trackManager}>
      {document.romanizationTracks.map((track, index) => <div key={track.id}><strong>轨道 {index + 1}</strong>
        <DraftInput value={track.language ?? ''} label={`音译轨道 ${index + 1} 语言`} placeholder="语言" onCommit={(language) => dispatch({ type: 'set-romanization-track-language', trackId: track.id, language: language || null })} />
        <span>{track.contents.length} 项</span>
        <IconButton icon="up" label="上移音译轨道" data-role="inline" disabled={index === 0} onClick={() => dispatch({ type: 'move-romanization-track', trackId: track.id, direction: -1 })}/>
        <IconButton icon="down" label="下移音译轨道" data-role="inline" disabled={index === document.romanizationTracks.length - 1} onClick={() => dispatch({ type: 'move-romanization-track', trackId: track.id, direction: 1 })}/>
        <IconButton icon="trash" label="删除音译轨道" data-role="danger" onClick={() => dispatch({ type: 'delete-romanization-track', trackId: track.id })}/>
      </div>)}
      <IconButton icon="add" label="新增轨道音译轨道" data-role="inline" onClick={() => dispatch({ type: 'add-romanization-track', track: { id: crypto.randomUUID(), language: null, contents: [] } })}/>
    </div></SettingsDialog>}
    {contentTransfer && (() => {
      const track = document.romanizationTracks.find((item) => item.id === contentTransfer.trackId);
      const content = track?.contents.find((item) => item.id === contentTransfer.contentId);
      if (!track || !content) return null;
      return <SettingsDialog title="转移音译内容" close={() => setContentTransfer(null)} actions={<><button data-role="secondary" onClick={() => setContentTransfer(null)}>取消</button><button data-role="secondary" onClick={() => {
          const afterContentId = track.contents.filter((item) => item.lineId === contentTransfer.targetLineId).at(-1)?.id ?? null;
          if (dispatch({ type: 'move-romanization-content', trackId: track.id, contentId: content.id, lineId: contentTransfer.targetLineId, afterContentId })) setContentTransfer(null);
        }}>应用（一次撤销）</button></>}><p>{content.kind === 'plain' ? content.text : content.units.map((unit) => unit.text).join('')}</p>
        <label>目标主行 <Select value={contentTransfer.targetLineId} onChange={(event) => setContentTransfer({ ...contentTransfer, targetLineId: event.target.value })}>
          {mainLines.filter((line) => line.id !== content.lineId).map((line) => <option key={line.id} value={line.id}>{lineText(line) || '空行'}</option>)}
        </Select></label>
        <p>文字与独立时间保持原值，主行引用会改变。</p>

      </SettingsDialog>;
    })()}
    {segmentationOpen && <SegmentationPanel document={document} selection={selection} currentLineId={selectedLine?.id ?? null} apply={dispatch} close={() => setSegmentationOpen(false)} />}
    {batchToolsOpen && <BatchToolsPanel document={document} selection={selection} currentLineId={selectedLine?.id ?? null} apply={dispatch} close={() => setBatchToolsOpen(false)} />}
    {romanizationGeneration && <RomanizationGenerationDialog document={document} lineIds={romanizationGeneration}
      preferenceScope={props.projectId ? `project:${props.projectId}` : `local:${props.title}`} apply={dispatch} close={() => setRomanizationGeneration(null)} />}
    {rubyGeneration && <RubyGenerationDialog document={document} lineIds={rubyGeneration.lineIds} initialTrackId={rubyGeneration.trackId} initialContentId={rubyGeneration.contentId}
      apply={dispatch} close={() => setRubyGeneration(null)} />}
    {splitLineId && document.lines.find((line) => line.id === splitLineId) && <LineSplitDialog key={splitLineId} line={document.lines.find((line) => line.id === splitLineId)!}
      background={document.lines.find((line) => line.backgroundOf === splitLineId) ?? null}
      attached={document.romanizationTracks.flatMap((track) => track.contents.filter((content) => content.lineId === splitLineId).map((content) => ({ track, content })))}
      close={() => setSplitLineId(null)}
      submit={(beforeWordId, contentIdsForNewLine, backgroundTarget, translationIndicesForNewLine) => dispatch({ type: 'split-line', lineId: splitLineId, beforeWordId, newLineId: crypto.randomUUID(), contentIdsForNewLine, backgroundTarget, translationIndicesForNewLine })} />}
    {contextMenu && <EditorContextMenu x={contextMenu.x} y={contextMenu.y} title={contextMenu.title} actions={contextMenu.actions} close={closeContext} />}
  </div>;
}
