import { CueSlot, CueProperties, KaraokeTools } from '../KaraokeTools';
import type { KaraokeCommand } from '../../domain/karaoke';
import { MessageBar, useNotice, type Notice } from '../../shared/MessageBar';
import { AmllSettings } from '../AmllPanel';
import type { ValidationTab } from '../useAutomaticValidation';
import type { AmllRule } from '../../domain/amll-compatibility';
import { displayLines } from '../../domain/amll-compatibility';
import type { ProjectEditing } from '../../domain/project-editing';
import { SyncLine } from './SyncLine';
import { useSyncProgress } from './sync-progress';
import { useProjectEditing } from './ProjectEditingContext';
import { emptyBeatCount } from '../../domain/project-editing';
import { Icon } from '../../shared/Icon';
import { Fragment } from 'react';
import { documentTargets, selectionKind, targetId, targetSelection, selectionTargets, targetInterval } from './selection-targets';
import { SelectionProvider, useEditorSelection } from './SelectionContext';
import { flushSync } from 'react-dom';
import { JapaneseRubyDialog } from './JapaneseRubyDialog';
import { Select } from '../../shared/Select';
import { useAudioReview } from '../AudioReviewContext';
import { AlignmentPanel, type AlignmentControl } from '../AlignmentPanel';
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
import { lazy, Suspense, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type RefObject } from 'react';
import { planWordMerge, planRubyMerge, type LyricCommand } from '../../domain/lyric-commands';
import { createLine, createWord, lineText, type LyricDocument, type LyricLine, type LyricWord } from '../../domain/lyric-document';
import { utf16ToCodePoint } from '../../domain/text-boundaries';
import { DEFAULT_SEGMENT_OPTIONS, distributeSegmentTime, segmentText } from '../../domain/segmentation';
import { distributeRubyTime, splitReadingMora } from '../../domain/ruby-editing';
import { copySelection, cutSelection, deleteSelection, invertIds, moveWordsAcrossLine, pastePlain, pasteRich, selectIds, selectionLineId, type EditorClipboard, type EditorSelection } from './editing-actions';
import { LyricList, type ListMemory } from './LyricList';
import { LyricLine as LyricLineView } from './LyricLine';
import { LyricWord as LyricWordView } from './LyricWord';
import { InlineDraft } from './InlineAdd';
import { EmptyBeatField, DraftInput, TimePair } from './EditorFields';
import { ColumnSeparator } from './ColumnSeparator';
import { OutlineRow } from './OutlineRow';
import { COLUMN_LIMITS, COLUMN_STORAGE, readColumnPreferences, renderedColumns, type ColumnPreferences, type ColumnSide } from './column-preferences';
import { EditorMenu } from './EditorMenu';
import { EditorRibbon } from './EditorRibbon';
import { SegmentationPanel } from './SegmentationPanel';
import { BatchToolsPanel } from './BatchToolsPanel';
import { RubyWordEditor } from './RubyWordEditor';
import { TranslationTrackDialog } from './TranslationTrackDialog';
import { translationsForLine } from '../../domain/lyric-document';
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
  alignment?: AlignmentControl;
  historyVersion?: number;
  project?: ProjectDocument;
  applyProject?: (command: ProjectCommand) => void;
  audioDurationMs?: number;
  sourceAssetId?: string;
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
  notices?: (Notice | null)[];
  outputIssues?: OutputIssue[];
  onSave: () => void;
  onNew?: () => void;
  onImportName?: (name: string) => void;
  onExportFormat?: (format: LyricFormat) => void;
  saveForPackaging?: () => Promise<{ revision: string; document: LyricDocument; editing?: ProjectEditing } | undefined>;
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
  const shared = useEditorSelection();
  return shared ? <EditorWorkspaceContent key={props.projectId} {...props} /> : <SelectionProvider><EditorWorkspaceContent key={props.projectId} {...props} /></SelectionProvider>;
}

// Cached rows keep event functions stable while every invocation reads current state.
function useLiveCallback<Args extends unknown[], Result>(callback: (...args: Args) => Result) {
  const latest = useRef(callback); latest.current = callback;
  return useRef((...args: Args) => latest.current(...args)).current;
}

function EditorWorkspaceContent(props: Props) {
  const editing = useProjectEditing();
  const audioReview = useAudioReview();
  const { document, apply } = props;
  const searchConditions = useSearchConditions(props.projectId);
  const [acquisitionStore] = useState(() => new AcquisitionStore());
  useEffect(() => { acquisitionStore.activate(); return () => acquisitionStore.dispose(); }, [acquisitionStore]);
  const { selection, setSelection, commands: selectionCommands } = useEditorSelection()!;
  const selectionRef = useRef(selection); selectionRef.current = selection;
  const [syncTargetVersion, setSyncTargetVersion] = useState(0);
  const [clipboard, setClipboard] = useState<EditorClipboard | null>(null);
  const clipboardToken = useRef('');
  const pageRef = useRef<HTMLDivElement>(null);
  const wordInputs = useRef(new Map<string, HTMLInputElement>());
  const [mode, setMode] = useState<'audio' | 'acquire' | 'edit' | 'sync' | 'karaoke' | 'preview' | 'package'>(() => {
    const remembered = props.projectId ? localStorage.getItem(`studio:workspace-mode:project:${props.projectId}`) : null;
    if (remembered === 'audio' || remembered === 'acquire' || remembered === 'edit' || remembered === 'karaoke' || remembered === 'sync' || remembered === 'preview' || remembered === 'package') return remembered;
    return props.projectId && !document.lines.some(line => line.words.some(word => word.text.trim())) ? 'acquire' : 'edit';
  });
  useEffect(() => { if (props.projectId) localStorage.setItem(`studio:workspace-mode:project:${props.projectId}`, mode); }, [props.projectId, mode]);
  const [karaokeExportOpen,setKaraokeExportOpen]=useState(false);
  const [karaokeValidation,setKaraokeValidation]=useState(false);
  const {selectedCue,selectCue}=useEditorSelection()!;
  const cue=props.project?.karaoke.cues.find(c=>c.id===selectedCue);
  const [validationTab,setValidationTab]=useState<ValidationTab>('lyrics');
  const [focusRule,setFocusRule]=useState<AmllRule>();
  const [amllOpen,setAmllOpen]=useState(false);
  const amllNavigating=useRef(false);
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
  const [settingsDialog, setSettingsDialog] = useState<'metadata' | 'singers' | 'tracks' | 'translations' | null>(null);
  const [message, setMessage] = useNotice();
  const [segmentationOpen, setSegmentationOpen] = useState(false);
  const [batchToolsOpen, setBatchToolsOpen] = useState(false);
  const [rubyShortcut, setRubyShortcut] = useState<{ wordId: string; serial: number; afterRubyId?: string | null } | null>(null);
  const rubyShortcutSerial = useRef(0);
  const [syncEditingId, setSyncEditingId] = useState<string | null>(null);
  const syncDraftCommit = useRef<(() => boolean) | null>(null);
  const finishSyncDraft = () => { let ok = true; flushSync(() => { ok = syncDraftCommit.current?.() ?? true; }); return ok; };
  const [wordDraft, setWordDraft] = useState<{ lineId: string; afterWordId: string | null; serial: number } | null>(null);
  const wordDraftSerial = useRef(0);
  const [splitLineId, setSplitLineId] = useState<string | null>(null);
  const [contentTransfer, setContentTransfer] = useState<{ trackId: string; contentId: string; targetLineId: string } | null>(null);
  const [romanizationGeneration, setRomanizationGeneration] = useState<string[] | null>(null);
  const [japaneseRuby, setJapaneseRuby] = useState<string[] | null>(null);
  const canvasComposing = useRef(false), editRejected = useRef(false);
  const openJapaneseRuby = (ids: string[]) => {
    if (canvasComposing.current) { setMessage('请先完成输入法组合'); return; }
    flushSync(() => { const active = window.document.activeElement; if (active instanceof HTMLElement) active.blur(); });
    if (editRejected.current || pageRef.current?.querySelector('[aria-invalid="true"]')) { setMessage('请先修正当前无效输入'); return; }
    if (ids.length) setJapaneseRuby(ids);
  };
  const [rubyGeneration, setRubyGeneration] = useState<{ lineIds: string[]; trackId?: string; contentId?: string } | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; title: string; actions: ContextAction[]; target: HTMLElement } | null>(null);
  const [locate, setLocate] = useState<{ id: string; serial: number; focus?: string; selector?: string } | null>(null);
  const locateSerial = useRef(0);
  const listMemory = useRef<Record<'edit' | 'sync' | 'karaoke', ListMemory>>({ karaoke: {offset:0,handled:null}, edit: { offset: 0, handled: null }, sync: { offset: 0, handled: null } });
  const requestLocate = (id: string, focus?: string) => setLocate({ id, focus, serial: ++locateSerial.current });
  useEffect(()=>{if(cue){setMode('karaoke');requestLocate(cue.anchor.lineId,`[data-cue-id="${CSS.escape(cue.id)}"]`);}},[selectedCue]);
  const pendingFocus = useRef<string | null>(null);
  useEffect(() => {
    setSelection(current => {
      if (!current) return current;
      if (current.kind === 'romanization-content') {
        const contents = document.romanizationTracks.flatMap(track => track.contents);
        const ids = current.ids.filter(id => contents.some(content => content.id === id));
        return ids.length === current.ids.length ? current : null;
      }
      const targets = documentTargets(document).filter(target => selectionKind(target) === current.kind && current.ids.includes(targetId(target)));
      const ids = targets.map(targetId);
      if (!ids.length) return null;
      const active = targets.find(target => targetId(target) === current.activeId) ?? targets.at(-1)!;
      const next = targetSelection(active, ids, ids.includes(current.anchorId) ? current.anchorId : ids[0]);
      return JSON.stringify(next) === JSON.stringify(current) ? current : next;
    });
  }, [document, selection]);
  const activeLineId = selectionLineId(selection) ?? props.selectedLineId;
  const selectedLine = document.lines.find((line) => line.id === activeLineId) ?? document.lines[0];
  // The active canvas selection is the single source of the timing target.
  const selectedTargets = useMemo(() => selectionTargets(document, selection), [document, selection]);
  const activePropertyTarget = selectedTargets.find(target => targetId(target) === selection?.activeId);
  const propertyWord = activePropertyTarget && (activePropertyTarget.kind === 'word' || activePropertyTarget.kind === 'ruby')
    ? document.lines.find(line => line.id === activePropertyTarget.lineId)?.words.find(word => word.id === activePropertyTarget.wordId) : undefined;
  const propertyText = activePropertyTarget?.kind === 'ruby' ? propertyWord?.rubyUnits.find(unit => unit.id === activePropertyTarget.rubyId)?.reading : propertyWord?.text;
  const activePropertyInterval = activePropertyTarget && targetInterval(document, activePropertyTarget);
  const syncLine = document.lines.find(line => line.id === activePropertyTarget?.lineId);
  const syncCursor = syncUnits(document, editing, syncLine?.backgroundOf ? syncLine.id : undefined).find(unit => {
    if (!selection || !selection.ids.includes(selection.activeId)) return false;
    if (selection.kind === 'lines') return unit.lineId === selection.activeId;
    if (selection.kind === 'words') return unit.wordId === selection.activeId;
    if (selection.kind === 'ruby') return unit.rubyUnitId === selection.activeId;
    return false;
  }) ?? null;
  const [syncProgress, setSyncProgress] = useSyncProgress(document, editing, syncCursor, syncTargetVersion, props.historyVersion ?? 0);
  const mainLines = useMemo(() => document.lines.filter((line) => !line.backgroundOf), [document.lines]);
  const ordinalById = useMemo(() => visibleLineOrdinals(document), [document]);
  // Track creation/removal affects every row's new-content target, including empty rows.
  const translationVersion = useRef({ tracks: document.translationTracks, serial: 0 });
  if (translationVersion.current.tracks !== document.translationTracks) translationVersion.current = { tracks: document.translationTracks, serial: translationVersion.current.serial + 1 };
  const attachmentVersions = useMemo(() => {
    const result = new Map<string, unknown[]>();
    for (const [kind, tracks] of [['romanization', document.romanizationTracks], ['translation', document.translationTracks]] as const) {
      tracks.forEach((track, index) => track.contents.forEach(content => {
        const entries = result.get(content.lineId) ?? [];
        entries.push([kind, index, track.id, track.language, 'purpose' in track ? track.purpose : null, content]);
        result.set(content.lineId, entries);
      }));
    }
    return result;
  }, [document.romanizationTracks, document.translationTracks]);
  const previousMode = useRef(mode);
  const externalSelection = useRef(props.selectedLineId);
  useEffect(() => {
    const returned = previousMode.current !== mode && (mode === 'edit' || mode === 'sync' || mode === 'karaoke');
    // ProjectEditor derives selectedLineId from this same selection context.
    // Its acknowledgement must not recenter a row under a stationary pointer.
    const external = externalSelection.current !== props.selectedLineId && props.selectedLineId !== selectionLineId(selection);
    previousMode.current = mode; externalSelection.current = props.selectedLineId;
    if (!returned && !external) return;
    // Validation links explicitly request keyboard focus; returning must not supersede them.
    if (returned && locate?.focus) return;
    if (syncDraftCommit.current && !syncDraftCommit.current()) return;
    const target = activePropertyTarget;
    const lineId = target?.lineId ?? (selection?.kind === 'romanization-content' ? selection.lineId : selection ? null : props.selectedLineId);
    if (!lineId || !document.lines.some(line => line.id === lineId)) { setLocate(null); return; }
    const selector = target?.kind === 'word' ? `[data-word-id="${CSS.escape(target.wordId)}"]`
      : target?.kind === 'ruby' ? `[data-ruby-id="${CSS.escape(target.rubyId)}"]`
      : target?.kind === 'romanization' ? `[data-romanization-unit-id="${CSS.escape(target.unitId)}"]` : undefined;
    setLocate({ id: lineId, selector, serial: ++locateSerial.current });
  }, [mode, props.selectedLineId, activePropertyTarget, selection, document]);
  useEffect(() => {
    const pane = outlineRef.current?.querySelector<HTMLElement>(`.${styles.panelBody}`);
    const lineId = activePropertyTarget?.lineId ?? activeLineId;
    const row = lineId && pane?.querySelector<HTMLElement>(`[data-line-id="${CSS.escape(lineId)}"]`);
    if (!pane || !row) return;
    const view = pane.getBoundingClientRect(), box = row.getBoundingClientRect();
    if (box.top < view.top) pane.scrollTop += box.top - view.top;
    else if (box.bottom > view.bottom) pane.scrollTop += box.bottom - view.bottom;
  }, [activePropertyTarget?.lineId, activeLineId, mode, columns.outlineVisible]);
  const mainIds = mainLines.map((line) => line.id);
  const occupiedParents = new Set(document.lines.filter(line => line.backgroundOf && line.id !== selectedLine?.id).map(line => line.backgroundOf));
  const propertyLines = selectedLine?.backgroundOf && !(selection?.kind === 'lines' && selection.ids.includes(selectedLine.id)) ? [selectedLine]
    : selection?.kind === 'lines' && selection.ids.length ? document.lines.filter(line => selection.ids.includes(line.id)) : selectedLine ? [selectedLine] : [];
  const selectedMainLines = propertyLines.filter(line => !line.backgroundOf);
  const selectedWordLineIndexes = selection?.kind === 'words'
    ? document.lines.flatMap((line, index) => line.words.some((word) => selection.ids.includes(word.id)) ? [index] : []) : [];
  const selectLine = useLiveCallback((line: LyricLine, shift: boolean = false, toggle: boolean = false) => {
    if (syncDraftCommit.current && !finishSyncDraft()) return;
    setSyncTargetVersion(value => value + 1);
    const id = line.id;
    const currentSelection = selectionRef.current;
    const previous = currentSelection?.kind === 'lines' ? currentSelection : null;
    const ids = !shift && !toggle && previous?.ids.includes(id) ? previous.ids : selectIds(displayLines(document,props.project?.lineOrder??[]).map(l => l.id), previous?.ids ?? [], previous?.anchorId ?? id, id, shift, toggle);
    setSelection({ kind: 'lines', ids, anchorId: shift || toggle || previous?.ids.includes(id) ? previous?.anchorId ?? id : id, activeId: line.id });
    props.onSelectLine?.(line.id);
    props.onSelectUnit?.(line.id, null, null);
  });
  const selectWord = useLiveCallback((line: LyricLine, word: LyricWord, shift: boolean = false, toggle: boolean = false) => {
    if (syncDraftCommit.current && !finishSyncDraft()) return;
    setSyncTargetVersion(value => value + 1);
    const currentSelection = selectionRef.current;
    const previous = currentSelection?.kind === 'words' ? currentSelection : null;
    const order = displayLines(document, props.project?.lineOrder ?? []).flatMap(item => item.words.map(word => word.id));
    const ids = !shift && !toggle && previous?.ids.includes(word.id) ? previous.ids : selectIds(order, previous?.ids ?? [], previous?.anchorId ?? word.id, word.id, shift, toggle);
    setSelection({ kind: 'words', lineId: line.id, ids, anchorId: shift || toggle || previous?.ids.includes(word.id) ? previous?.anchorId ?? word.id : word.id, activeId: word.id });
    props.onSelectLine?.(line.id);
    props.onSelectUnit?.(line.id, word.id, null);
  });
  const selectRuby = useLiveCallback((line: LyricLine, word: LyricWord, rubyId: string, shift: boolean = false, toggle: boolean = false) => {
    if (syncDraftCommit.current && !finishSyncDraft()) return;
    setSyncTargetVersion(value => value + 1);
    const currentSelection = selectionRef.current;
    const previous = currentSelection?.kind === 'ruby' ? currentSelection : null;
    const order = displayLines(document, props.project?.lineOrder ?? []).flatMap(line => line.words.flatMap(word => word.rubyUnits.map(unit => unit.id)));
    const ids = !shift && !toggle && previous?.ids.includes(rubyId) ? previous.ids : selectIds(order, previous?.ids ?? [], previous?.anchorId ?? rubyId, rubyId, shift, toggle);
    setSelection({ kind: 'ruby', lineId: line.id, wordId: word.id, ids, anchorId: shift || toggle || previous?.ids.includes(rubyId) ? previous?.anchorId ?? rubyId : rubyId, activeId: rubyId });
    props.onSelectLine?.(line.id);
    props.onSelectUnit?.(line.id, word.id, rubyId);
  });
  const selectRomanizationContent = useLiveCallback((lineId: string, trackId: string, contentId: string, shift: boolean = false, toggle: boolean = false) => {
    if (syncDraftCommit.current && !finishSyncDraft()) return;
    setSyncTargetVersion(value => value + 1);
    const currentSelection = selectionRef.current;
    const previous = currentSelection?.kind === 'romanization-content' && currentSelection.trackId === trackId && currentSelection.lineId === lineId ? currentSelection : null;
    const order = document.romanizationTracks.find((track) => track.id === trackId)?.contents.filter((content) => content.lineId === lineId).map((content) => content.id) ?? [];
    const ids = !shift && !toggle && previous?.ids.includes(contentId) ? previous.ids : selectIds(order, previous?.ids ?? [], previous?.anchorId ?? contentId, contentId, shift, toggle);
    setSelection({ kind: 'romanization-content', lineId, trackId, contentId, ids, anchorId: shift || toggle || previous?.ids.includes(contentId) ? previous?.anchorId ?? contentId : contentId, activeId: contentId });
    props.onSelectLine?.(lineId);
    props.onSelectRomanization?.(trackId, contentId);
  });
  const selectRomanizationUnit = useLiveCallback((lineId: string, trackId: string, contentId: string, unitId: string, shift: boolean = false, toggle: boolean = false) => {
    if (syncDraftCommit.current && !finishSyncDraft()) return;
    setSyncTargetVersion(value => value + 1);
    const currentSelection = selectionRef.current;
    const previous = currentSelection?.kind === 'romanization-unit' ? currentSelection : null;
    const content = document.romanizationTracks.find((track) => track.id === trackId)?.contents.find((item) => item.id === contentId);
    const order = document.romanizationTracks.find(track => track.id === trackId)?.contents.flatMap(content => content.kind === 'timed' ? content.units.map(unit => unit.id) : []) ?? [];
    const ids = !shift && !toggle && previous?.ids.includes(unitId) ? previous.ids : selectIds(order, previous?.ids ?? [], previous?.anchorId ?? unitId, unitId, shift, toggle);
    setSelection({ kind: 'romanization-unit', lineId, trackId, contentId, ids, anchorId: shift || toggle || previous?.ids.includes(unitId) ? previous?.anchorId ?? unitId : unitId, activeId: unitId });
    props.onSelectLine?.(lineId);
    props.onSelectRomanization?.(trackId, contentId);
  });
  const [focusAgent,setFocusAgent] = useState<string>();
  const locateIssue = (issue: OutputIssue) => {
    if(issue.cueId && props.project) { const cue=props.project.karaoke.cues.find(c=>c.id===issue.cueId);if(cue){setMode('karaoke');selectCue(cue.id,cue.anchor.lineId);requestLocate(cue.anchor.lineId,`[data-cue-id="${CSS.escape(cue.id)}"]`);}return;}
    if(issue.karaokeSettings){setMode('karaoke');if(issue.lineId){const line=document.lines.find(l=>l.id===issue.lineId);if(line)selectLine(line);}else setKaraokeExportOpen(true);return;}
    if(issue.kind === 'agent') { setMode('edit'); setFocusAgent(issue.agentId); setSettingsDialog('singers'); return; }
    if (issue.kind === 'romanization-content' || issue.kind === 'romanization-unit' || issue.kind === 'translation-content' || issue.kind === 'translation-unit') {
      const tracks = issue.kind.startsWith('translation') ? document.translationTracks : document.romanizationTracks;
      const content = tracks.flatMap(track => track.contents).find(content => content.id === issue.contentId && content.lineId === issue.lineId);
      if (!content || issue.unitId && (content.kind !== 'timed' || !content.units.some(unit => unit.id === issue.unitId))) return;
    }
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
    } else if (issue.kind === 'translation-content' || issue.kind === 'translation-unit') { setSelection(null); focus = issue.unitId ? `[data-translation-unit-id="${CSS.escape(issue.unitId)}"] input` : `[data-translation-id="${CSS.escape(issue.contentId!)}"] :is(input, textarea)`; } else selectLine(line);
    requestLocate(line.id,focus);
  };
  const assignmentIssues: OutputIssue[] = props.assignmentError ? props.assignmentError.objectIds.map(id=>{
    const line=document.lines.find(l=>l.id===props.assignmentError!.lineId);
    const base={lineId:props.assignmentError!.lineId,missing:[],message:props.assignmentError!.message} satisfies Omit<OutputIssue,'kind'>;
    const word=line?.words.find(w=>w.id===id||w.rubyUnits.some(u=>u.id===id));
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
  const pendingCue=useRef(false);
  const applyKaraokeCommand = (command:KaraokeCommand) => {
    if(command.kind==='insert')pendingCue.current=true;
    try { props.applyProject?.({type:'karaoke',command}); } catch(error) { setMessage((error as Error).message); throw error; }
  };
  const insertKaraoke = (command:KaraokeCommand) => {
    if(command.kind==='insert')pendingCue.current=true;
    try { applyKaraokeCommand(command); } catch { return; }
  };
  const previousCues=useRef(props.project?.karaoke.cues??[]);
  useEffect(()=>{const old=previousCues.current,next=props.project?.karaoke.cues??[];const removed=old.filter(c=>!next.some(n=>n.id===c.id));if(pendingCue.current){const inserted=next.find(c=>!old.some(o=>o.id===c.id));if(inserted)selectCue(inserted.id,inserted.anchor.lineId);pendingCue.current=false;}if(removed.length)setMessage(`已移除 ${removed.length} 个导唱；可与本次操作一起撤销`,'status',4000);previousCues.current=next;},[props.project]);
  const dispatch = useLiveCallback((command: LyricCommand) => {
    try { apply(command); editRejected.current = false; setMessage(''); return true; }
    catch (error) { editRejected.current = true; setMessage(error instanceof Error ? error.message : '编辑失败'); return false; }
  });
  const drag = useObjectDrag(document, pageRef, dispatch, setSelection);
  const displayed = useMemo(() => ({ ...drag.document, lines: displayLines(drag.document, props.project?.lineOrder ?? []) }), [drag.document, props.project?.lineOrder]);
  const displayOrder = useMemo(() => displayLines(document, props.project?.lineOrder ?? []), [document, props.project?.lineOrder]);
  const currentSelection = (): EditorSelection | null => selection;
  const copy = (target?: EditorSelection) => {
    const current = target ?? currentSelection();
    if (!current?.ids.length) return null;
    if (!copyAllowed(current)) { setMessage('跨内容音译复制暂不支持，请选择同一份内容'); return null; }
    const next = copySelection(document, current, editing);
    clipboardToken.current = crypto.randomUUID();
    setClipboard(next);
    setMessage('已复制到编辑器剪贴板', 'status');
    return next;
  };
  const cut = (target?: EditorSelection) => {
    const current = target ?? currentSelection();
    if (!current?.ids.length) return null;
    if (!copyAllowed(current)) { setMessage('跨内容音译复制暂不支持，请选择同一份内容'); return null; }
    const next = copySelection(document, current, editing);
    if (dispatch(cutSelection(document, current))) {
      setClipboard(next);
      clipboardToken.current = crypto.randomUUID();
      const available = current.kind !== 'lines' ? current.lineId : mainIds.filter((id) => !current.ids.includes(id)).at(-1);
      setSelection(current.kind === 'lines' && available ? { kind: 'lines', ids: [available], anchorId: available, activeId: available } : null);
      mainRef.current?.focus({ preventScroll: true });
      return next;
    }
    return null;
  };
  const removeSelection = (current = selection) => {
    if (!current?.ids.length) return;
    if (dispatch(deleteSelection(document, current))) {
      const available = current.kind === 'lines' ? mainIds.find(id => !current.ids.includes(id)) : current.lineId;
      setSelection(current.kind === 'lines' && available ? { kind: 'lines', ids: [available], anchorId: available, activeId: available } : null);
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
  const copyAllowed = (current: EditorSelection | null) => current?.kind !== 'romanization-unit' || document.romanizationTracks.flatMap(track => track.contents.filter(content => content.kind === 'timed' && content.units.some(unit => current.ids.includes(unit.id)))).length <= 1;
  const canCopySelection = copyAllowed(selection);
  useEffect(() => {
    selectionCommands.current = { copy: () => { try { return copy(); } catch (cause) { setMessage((cause as Error).message); return null; } }, cut: () => { try { return cut(); } catch (cause) { setMessage((cause as Error).message); return null; } }, remove: () => removeSelection(), paste: text => paste(text ? null : clipboard, text), canCopy: Boolean(selection?.ids.length) && canCopySelection, canPaste: Boolean(clipboard), clipboardToken: () => clipboardToken.current };
  });
  const selectAll = (invert: boolean) => {
    if (selection?.kind === 'ruby') {
      const order = document.lines.find((line) => line.id === selection.lineId)?.words.find((word) => word.id === selection.wordId)?.rubyUnits.map((unit) => unit.id) ?? [];
      const ids = invert ? invertIds(order, selection.ids) : order;
      setSelection({ ...selection, ids, anchorId: ids[0] ?? '', activeId: ids.at(-1) ?? '' });
    } else if (selection?.kind === 'romanization-unit') {
      const content = document.romanizationTracks.find((track) => track.id === selection.trackId)?.contents.find((item) => item.id === selection.contentId);
      const order = document.romanizationTracks.find(track => track.id === selection.trackId)?.contents.flatMap(content => content.kind === 'timed' ? content.units.map(unit => unit.id) : []) ?? [];
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
  const startWordDraft = useLiveCallback((lineId: string, afterWordId: string | null) => {
    setWordDraft({ lineId, afterWordId, serial: ++wordDraftSerial.current });
    requestLocate(lineId, '[data-word-draft] input');
  });
  const renderWordDraft = (line: LyricLine, afterWordId: string | null) => wordDraft?.lineId === line.id && wordDraft.afterWordId === afterWordId &&
    <span data-word-draft key={`draft-${wordDraft.serial}`}><InlineDraft label="添加词" close={() => setWordDraft(null)} commit={text => {
      const word = createWord(text);
      if (!dispatch({ type: 'insert-word', lineId: line.id, afterWordId, word })) return false;
      setSelection({ kind: 'words', lineId: line.id, ids: [word.id], anchorId: word.id, activeId: word.id });
      props.onSelectLine?.(line.id); props.onSelectUnit?.(line.id, word.id, null);
      requestLocate(line.id, `[data-word-id="${word.id}"]${mode === 'sync' ? '' : ' input[aria-label^="词 "]'}`);
      return true;
    }} /></span>;
  const mergeAction = (kind: 'words' | 'ruby', ids: string[], multiple: boolean): ContextAction => {
    const label = multiple ? '合并' : kind === 'words' ? '合并前一词' : '合并前一读音';
    try {
      if (kind === 'words') planWordMerge(document, ids); else planRubyMerge(document, ids);
    } catch (cause) { return { label, disabled: true, reason: (cause as Error).message, run: () => {} }; }
    return { label, run: () => {
      if (kind === 'words') {
        const { line, merged } = planWordMerge(document, ids);
        if (dispatch({ type: 'merge-words', wordIds: ids })) {
          setSelection({ kind, lineId: line.id, ids: [merged.id], anchorId: merged.id, activeId: merged.id });
          props.onSelectUnit?.(line.id, merged.id, null);
          requestLocate(line.id, `[data-word-id="${merged.id}"]${mode === 'sync' ? '' : ' input[aria-label^="词 "]'}`);
        }
      } else {
        const { line, word, merged } = planRubyMerge(document, ids);
        if (dispatch({ type: 'merge-ruby', rubyIds: ids })) {
          setSelection({ kind, lineId: line.id, wordId: word.id, ids: [merged.id], anchorId: merged.id, activeId: merged.id });
          props.onSelectUnit?.(line.id, word.id, merged.id);
          requestLocate(line.id, `[data-ruby-id="${merged.id}"]${mode === 'sync' ? '' : ' input'}`);
        }
      }
    } };
  };
  const openContext = (target: HTMLElement, x: number, y: number) => {
    const beat = target.closest<HTMLElement>('[data-beat-owner]');
    if (beat) {
      const id = beat.dataset.beatOwner!, kind = beat.dataset.beatKind as 'word' | 'ruby', count = emptyBeatCount(editing, id);
      const change = (count: number) => dispatch({ type: 'set-empty-beat', id, kind, count });
      setContextMenu({ x, y, target: beat, title: '后置空拍', actions: [
        { label: '增加空拍', disabled: count >= 32, run: () => change(count + 1) },
        { label: '减少空拍', disabled: count === 0, run: () => change(count - 1) },
        { label: '清空空拍', disabled: count === 0, run: () => change(0) },
      ] }); return true;
    }
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
      effective = selection?.kind === 'ruby' && selection.ids.includes(rubyId) ? { ...selection, lineId: line.id, wordId: word.id, activeId: rubyId }
        : { kind: 'ruby', lineId: line.id, wordId: word.id, ids: [rubyId], anchorId: rubyId, activeId: rubyId };
      title = '注音 操作';
      actions = [
        { label: '添加空拍', disabled: emptyBeatCount(editing, rubyId) >= 32, run: () => dispatch({ type: 'set-empty-beat', kind: 'ruby', id: rubyId, count: emptyBeatCount(editing, rubyId) + 1 }) },
        { label: '添加读音', run: () => { setRubyShortcut({ wordId: word.id, afterRubyId: rubyId, serial: ++rubyShortcutSerial.current }); } },
        { label: '拆分读音', disabled: Array.from(unit.reading).length < 2, run: () => dispatch({ type: 'split-ruby', lineId: line.id, wordId: word.id, rubyId, at: Math.floor(Array.from(unit.reading).length / 2) }) },
        mergeAction('ruby', effective.ids.length > 1 ? effective.ids : word.rubyUnits.slice(Math.max(0, index - 1), index + 1).map(unit => unit.id), effective.ids.length > 1),
        { label: '向前移动', disabled: index === 0, run: () => dispatch({ type: 'move-ruby', lineId: line.id, wordId: word.id, rubyId, afterRubyId: word.rubyUnits[index - 2]?.id ?? null }) },
        { label: '向后移动', disabled: index === word.rubyUnits.length - 1, run: () => dispatch({ type: 'move-ruby', lineId: line.id, wordId: word.id, rubyId, afterRubyId: word.rubyUnits[index + 1].id }) },
        { label: '按音拍拆分', disabled: splitReadingMora(unit.reading).length < 2, run: () => {
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
        effective = selection?.kind === 'romanization-unit' && selection.ids.includes(unit.id) ? { ...selection, lineId: line.id, trackId: track.id, contentId: content.id, activeId: unit.id }
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
          { label: '转移到其他歌词行…', disabled: document.lines.length < 2, run: () => setContentTransfer({ trackId: track.id, contentId: content.id, targetLineId: document.lines.find((item) => item.id !== line.id)?.id ?? '' }) },
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
        { label: '添加空拍', disabled: word.rubyUnits.length > 0 || emptyBeatCount(editing, word.id) >= 32, reason: word.rubyUnits.length ? '请对具体读音添加空拍' : undefined, run: () => dispatch({ type: 'set-empty-beat', kind: 'word', id: word.id, count: emptyBeatCount(editing, word.id) + 1 }) },
        { label: '前插词', run: () => startWordDraft(line.id, line.words[index - 1]?.id ?? null) },
        { label: '后插词', run: () => startWordDraft(line.id, word.id) },
        { label: '拆分词', disabled: Array.from(word.text).length < 2, run: () => {
          try {
            const parts = segmentText(word.text, DEFAULT_SEGMENT_OPTIONS);
            if (parts.length < 2) { setSegmentationOpen(true); return; }
            dispatch({ type: 'segment-words', changes: [{ lineId: line.id, wordId: word.id, words: distributeSegmentTime(word, parts, DEFAULT_SEGMENT_OPTIONS.punctuationWeight, editing) }] });
          } catch (cause) { setMessage((cause as Error).message); }
        } },
        mergeAction('words', effective.ids.length > 1 ? effective.ids : line.words.slice(Math.max(0, index - 1), index + 1).map(item => item.id), effective.ids.length > 1),
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
      effective = selection?.kind === 'lines' && selection.ids.includes(line.id) ? { ...selection, activeId: line.id }
        : { kind: 'lines', ids: [line.id], anchorId: line.id, activeId: line.id };
      title = '歌词行操作';
      actions = [
        { label: '生成日文注音…', run: () => openJapaneseRuby(effective.ids) },
        { label: '前插行', run: () => { const index = mainLines.findIndex((item) => item.id === id); dispatch({ type: 'insert-line', afterLineId: mainLines[index - 1]?.id ?? null }); } },
        { label: '后插行', run: () => dispatch({ type: 'insert-line', afterLineId: id }) },
        ...(document.romanizationTracks.some(track => track.contents.some(content => content.lineId === line.id))
          ? [{ label: '从音译生成 注音…', run: () => setRubyGeneration({ lineIds: effective.ids }) }] : []),
        { label: '生成日文罗马字音译…', run: () => setRomanizationGeneration(effective.ids) },
        { label: '添加词', run: () => startWordDraft(line.id, line.words.at(-1)?.id ?? null) },
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
      { label: '复制', disabled: !copyAllowed(effective), run: () => { copy(effective); } },
      { label: '剪切', disabled: !copyAllowed(effective), run: () => { cut(effective); } },
      { label: '粘贴', disabled: !clipboard, run: () => paste(clipboard, undefined, effective) },
    ];
    if (effective.ids.length > 1) actions = actions.map(action => ['合并', '前插词', '后插词'].includes(action.label) || action.label.startsWith('删除所选') || effective.kind === 'lines' && ['生成日文注音…', '生成日文罗马字音译…', '从音译生成 注音…', '分词…'].includes(action.label) ? action : { ...action, disabled: true });
    setSelection(effective);
    props.onSelectLine?.(line.id);
    if (effective.kind === 'romanization-content' || effective.kind === 'romanization-unit') props.onSelectRomanization?.(effective.trackId, effective.contentId);
    setContextMenu({ x, y, title, actions: [...shared, ...actions], target: target.closest<HTMLElement>('[data-ruby-id], [data-romanization-unit-id], [data-romanization-content-id], [data-word-id], [data-line-id]') ?? target });
    return true;
  };
  const ownsSelection = (target: EventTarget) => {
    if ((mode !== 'edit' && mode !== 'sync' && mode !== 'karaoke') || !selection?.ids.length || isTextInput(target)) return false;
    if (!(target instanceof Element) || target.closest('[role="dialog"], [role="menu"]')) return false;
    return Boolean(outlineRef.current?.contains(target) || mainRef.current?.contains(target));
  };
  const ownsClipboard = (target: EventTarget) => ownsSelection(target) && !window.getSelection()?.toString();
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
    <RubyWordEditor lineId={line.id} word={word} placeholderIds={drag.placeholders?.kind === 'ruby' ? drag.placeholders.ids : undefined} selectedRubyIds={selection?.kind === 'ruby' ? selection.ids : []}
      onSelectRuby={(rubyId, shift, toggle) => selectRuby(line, word, rubyId, shift, toggle)} apply={dispatch}
      requestAddSerial={rubyShortcut?.wordId === word.id ? rubyShortcut.serial : undefined} requestAfterRubyId={rubyShortcut?.wordId === word.id ? rubyShortcut.afterRubyId : undefined} />
    <div className={styles.wordMain}>
      <DraftInput value={word.text} label={`词 ${word.text}`} onFocus={() => selectWord(line, word)}
        onCommit={(text) => {
          const shortcut = text.endsWith('|');
          const next = shortcut ? text.slice(0, -1) : text;
          if (!next) { editRejected.current = true; setMessage('正文不能为空'); return; }
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
  </LyricWordView>;
  return <div ref={pageRef} data-workspace className={`${styles.page} ${props.embedded ? styles.embeddedPage : ''}`}
    onInputCapture={() => { editRejected.current = false; }}
    onCompositionStartCapture={() => { canvasComposing.current = true; }} onCompositionEndCapture={() => { canvasComposing.current = false; }}
    onPointerDownCapture={() => { pageRef.current!.dataset.pointerFocus = ''; }}
    onKeyDownCapture={() => { delete pageRef.current!.dataset.pointerFocus; }}
    onPointerDown={(event) => {
      if ((mode !== 'edit' && mode !== 'sync' && mode !== 'karaoke') || event.pointerType !== 'mouse' || event.button !== 0 || event.shiftKey) return;
      const element = event.target as Element;
      if (element.closest('[data-cue-id],input,select,textarea,a,[contenteditable="true"],[role="menu"]') || element.closest('button') && !element.closest('[data-outline-drag]')) return;
      const source = pointerSource(element);
      if (!source) return;
      event.preventDefault();
      const node = element.closest<HTMLElement>('[data-ruby-id], [data-romanization-unit-id], [data-romanization-content-id], [data-word-id], [data-line-id]')!;
      (element.closest<HTMLElement>('[data-outline-drag]') ?? node).focus({ preventScroll: true });
      const line = document.lines.find(line => line.id === source.lineId)!;
      const toggle = event.ctrlKey || event.metaKey;
      if (source.kind === 'line') {
        const clicked = document.lines.find(item => item.id === node.dataset.lineId)!;
        if (!toggle && selection?.kind === 'lines' && selection.ids.includes(source.lineId)) source.lineIds = selection.ids;
        selectLine(clicked, false, toggle);
      }
      else if (source.kind === 'word') {
        if (!toggle && selection?.kind === 'words' && selection.ids.includes(source.wordId)) source.wordIds = selection.ids;
        selectWord(line, line.words.find(word => word.id === source.wordId)!, false, toggle);
      }
      else if (source.kind === 'ruby') {
        if (!toggle && selection?.kind === 'ruby' && selection.ids.includes(source.rubyId)) source.rubyIds = selection.ids;
        selectRuby(line, line.words.find(word => word.id === source.wordId)!, source.rubyId, false, toggle);
      }
      else if (source.kind === 'romanization-content') selectRomanizationContent(line.id, source.trackId, source.contentId, false, toggle);
      else selectRomanizationUnit(line.id, source.trackId, source.contentId, source.unitId, false, toggle);
      drag.start(source, node, event.pointerId, event.clientX, event.clientY, event.altKey || event.ctrlKey && !event.metaKey, element.closest('[data-outline-drag]') ? () => requestLocate(node.dataset.lineId!) : undefined);
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
    onDoubleClick={event => {
      if (mode !== 'sync' || isTextInput(event.target)) return;
      const node = window.document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-ruby-id], [data-word-id]');
      const id = node?.dataset.rubyId ?? node?.dataset.wordId;
      if (id && finishSyncDraft()) setSyncEditingId(id);
    }}
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
    if (event.key === 'Delete') {
      if (!event.defaultPrevented && !event.repeat && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey
        && !drag.active() && !window.document.querySelector('[role="dialog"], [role="menu"], details[data-top-menu][open]')
        && ownsSelection(event.target)) {
        event.preventDefault();
        try { removeSelection(); } catch (error) { setMessage(error instanceof Error ? error.message : '删除失败'); }
      }
      return;
    }

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
    <fieldset disabled={props.alignment?.locked} style={{display:"contents"}}><EditorMenu {...props} onAmllSettings={props.project&&props.applyProject?()=>{amllNavigating.current=false;setActiveMenuId(null);setAmllOpen(true);}:undefined} activeMenuId={activeMenuId} onMenuChange={setActiveMenuId} outlineVisible={columns.outlineVisible} inspectorVisible={columns.inspectorVisible} onToggleOutline={() => toggleColumn('outline')} onToggleInspector={() => toggleColumn('inspector')} /></fieldset>
    <MessageBar notice={message} />
    {props.notices?.map((notice, index) => <MessageBar key={index} notice={notice} />)}
    <nav className={styles.modeTabs} aria-label="工作模式">{([['acquire','歌词获取'],['audio','音频处理'],['edit','编辑'],['sync','打轴'],['karaoke','卡拉 OK'],['preview','AMLL 预览'],['package','文件打包']] as const).map(([id,label]) => <button data-role="inline" key={id} aria-current={mode === id ? 'page' : undefined} onClick={() => { if (canvasComposing.current || !finishSyncDraft()) return; flushSync(() => { const input = window.document.activeElement; if (input instanceof HTMLInputElement) input.blur(); }); if (pageRef.current?.querySelector('[aria-invalid="true"]')) return; setLocate(null); setRubyShortcut(null); setMode(id); setActiveMenuId(null); }}>{label}</button>)}</nav>
    {props.projectId && props.project && props.alignment && <AlignmentPanel pid={props.projectId} project={props.project} control={props.alignment} assetId={props.sourceAssetId} durationMs={props.audioDurationMs??0} visible={mode==='audio'} finishDraft={()=>{
      if(canvasComposing.current || !finishSyncDraft())return false;
      flushSync(()=>{const active=window.document.activeElement;if(active instanceof HTMLElement)active.blur();});
      return !editRejected.current && !pageRef.current?.querySelector('[aria-invalid="true"]');
    }}/>}
    {props.projectId && props.project && props.applyProject && props.sourceAssetId && <VocalPanel locked={props.alignment?.locked} visible={mode==='audio'} projectId={props.projectId} project={props.project} sourceAssetId={props.sourceAssetId} apply={props.applyProject} durationMs={props.audioDurationMs??0}/>}
    {mode === 'audio' && (props.projectId && props.project && props.applyProject && props.sourceAssetId ? <div ref={layoutRef} className={vocalStyles.audioLayout} style={{gridTemplateColumns:template(rendered)}}>
      {columns.outlineVisible && <aside ref={outlineRef} className={styles.outline} aria-label="音频处理大纲"><h2>大纲</h2><div className={styles.panelBody}>{displayOrder.map(line => <div key={line.id} draggable onDragStart={e=>{selectLine(line);e.dataTransfer.setData(VOCAL_LINE_MIME,line.id);e.dataTransfer.effectAllowed="copy";const ghost=e.currentTarget.cloneNode(true) as HTMLElement;ghost.style.cssText="position:fixed;left:-10000px;opacity:.6;width:220px";window.document.body.appendChild(ghost);e.dataTransfer.setDragImage(ghost,20,16);setTimeout(()=>ghost.remove(),0);}}>
        <div onClick={event => selectLine(line, event.shiftKey, event.ctrlKey || event.metaKey)}><OutlineRow line={line} ordinal={ordinalById.get(line.backgroundOf ?? line.id)} selected={selection?.kind === 'lines' && selection.ids.includes(line.id)}/></div>
        {props.assignmentError?.lineId===line.id && <div role="alert" className={vocalStyles.error}>{props.assignmentError.message}{assignmentIssues.map((issue,i)=><button data-role="secondary" key={i} onClick={()=>locateIssue(issue)}>定位{issue.kind==='ruby'?'注音':issue.kind==='word'?'词':issue.kind==='romanization-unit'?'音译单元':'行'}{i+1}</button>)}</div>}
      </div>)}</div></aside>}
      {columns.outlineVisible && separator('outline')}
      <main ref={mainRef} tabIndex={-1} className={vocalStyles.main}><div ref={audioReview.setStatusHost}/><div hidden={!audioReview.timelineReady} className={vocalStyles.host} ref={props.onTimelineHost}/></main>
    </div> : <section className={styles.auxiliaryPlaceholder}><h1>人声分离与声学分析</h1><p>请从底部上传音乐文件，再进行人声处理。歌词可继续编辑、保存和下载。</p></section>)}
    <fieldset disabled={props.alignment?.locked} style={{display:"contents"}}>
    {mode === 'acquire' && <LyricAcquisition projectId={props.projectId} sourceAssetId={props.sourceAssetId} store={acquisitionStore} searchConditions={searchConditions} document={document} apply={apply} onImported={() => setMode('edit')} onNew={props.onNew} onImportName={props.onImportName} />}
    {mode === 'package' && <PackagingPanel {...props} karaokeOnly={karaokeValidation} onKaraokeOnly={setKaraokeValidation} resumeKaraoke={()=>{setMode("karaoke");setKaraokeExportOpen(true);}} validationTab={validationTab} onValidationTab={setValidationTab} focusRule={focusRule} onRuleLocated={()=>setFocusRule(undefined)} externalIssues={props.outputIssues} locateIssue={locateIssue} />}
    {mode === 'preview' && <Suspense fallback={<p>正在载入预览…</p>}><PreviewMode document={document} transport={props.transport} onSelectLine={id => { const line = document.lines.find(line => line.id === id); if (line) selectLine(line); }} /></Suspense>}
    {mode === 'karaoke' && props.project && props.applyProject && <KaraokeTools projectId={props.projectId} project={props.project} apply={props.applyProject} title={props.title} exportOpen={karaokeExportOpen} setExportOpen={setKaraokeExportOpen} viewIssues={()=>{setMode('package');setValidationTab('lyrics');setKaraokeValidation(true);}}/>}
    {mode === 'sync' && <SyncPanel progress={syncProgress} onProgress={setSyncProgress} preferenceScope={props.projectId ? `project:${props.projectId}` : `local:${props.title}`} document={document} cursor={syncCursor} targetVersion={syncTargetVersion} apply={dispatch} transport={props.transport}
      onCursor={(cursor) => { const line = document.lines.find((item) => item.id === cursor.lineId)!; const word = line.words.find((item) => item.id === cursor.wordId)!; if (cursor.rubyUnitId) selectRuby(line, word, cursor.rubyUnitId); else selectWord(line, word); requestLocate(line.id, cursor.rubyUnitId ? `[data-ruby-id="${cursor.rubyUnitId}"]` : `[data-word-id="${cursor.wordId}"]`); }} />}
    {mode === 'edit' && <EditorRibbon activeMenuId={activeMenuId} onMenuChange={setActiveMenuId} selection={selection} canCopy={canCopySelection} canPaste={Boolean(clipboard)}
      canMoveUp={selectedWordLineIndexes.length > 0 && selectedWordLineIndexes[0] > 0}
      canMoveDown={selectedWordLineIndexes.length > 0 && selectedWordLineIndexes.at(-1) !== document.lines.length - 1}
      copy={() => { copy(); }} cut={() => { cut(); }} remove={() => removeSelection()} paste={() => paste(clipboard)}
      selectAll={() => selectAll(false)} invertSelection={() => selectAll(true)}
      clearSelection={() => setSelection({ kind: 'lines', ids: [], anchorId: '', activeId: '' })}
      moveUp={() => moveSelectedWords(-1)} moveDown={() => moveSelectedWords(1)} openSegmentation={() => setSegmentationOpen(true)} openBatchTools={() => setBatchToolsOpen(true)}
      canGenerateJapaneseRuby={selection?.kind === 'lines' && selection.ids.length > 0} openJapaneseRuby={() => openJapaneseRuby(selection?.kind === 'lines' ? selection.ids : [])}
      canGenerateRuby={propertyLines.some((line) => document.romanizationTracks.some((track) => track.contents.some((content) => content.lineId === line.id)))}
      canGenerateRomanization={propertyLines.length > 0} openRomanizationGeneration={() => setRomanizationGeneration(propertyLines.map(line => line.id))} openTranslationTracks={() => setSettingsDialog('translations')} openTracks={() => setSettingsDialog('tracks')} openMetadata={() => setSettingsDialog('metadata')} singersDisabled={props.project?.amll.simplified} openSingers={() => setSettingsDialog('singers')} openRubyGeneration={() => setRubyGeneration({ lineIds: propertyLines.map((line) => line.id) })} />}
    {(mode === 'edit' || mode === 'sync' || mode === 'karaoke') && <div ref={layoutRef} className={styles.layout} style={{ gridTemplateColumns: template(rendered) }}>{columns.outlineVisible && <aside ref={outlineRef} className={styles.outline} onClick={event => {
      const button = (event.target as Element).closest('[data-outline-drag]');
      if (!button) return;
      const line = document.lines.find(item => item.id === button.parentElement!.getAttribute('data-line-id'))!;
      selectLine(line, event.shiftKey, event.ctrlKey || event.metaKey); requestLocate(line.id);
    }}><h2>大纲</h2><div className={styles.panelBody}>
      {displayed.lines.map(line => <OutlineRow key={line.id} line={line} placeholder={drag.isPlaceholder('line', line.backgroundOf ?? line.id)} ordinal={ordinalById.get(line.backgroundOf ?? line.id)}
        selected={selection?.kind === 'lines' && selection.ids.includes(line.id)} context={selection?.kind !== 'lines' && activePropertyTarget?.lineId === line.id} />)}
    </div></aside>}{columns.outlineVisible && separator('outline')}
      <main ref={mainRef} tabIndex={-1} className={styles.canvas}>
        <LyricList lineVersion={line => JSON.stringify([
          mode, mode==='karaoke' ? [props.project?.karaoke,selectedCue] : null, ordinalById.get(line.backgroundOf ?? line.id), props.playheadLineId === line.id,
          selection?.kind, selectedTargets.filter(target => target.lineId === line.id).map(targetId),
          selection?.kind === 'romanization-content' && selection.lineId === line.id ? selection.ids : null,
          translationVersion.current.serial, attachmentVersions.get(line.id),
          wordDraft?.lineId === line.id ? wordDraft : null,
          line.words.some(word => word.id === rubyShortcut?.wordId) ? rubyShortcut : null,
          line.words.some(word => word.id === syncEditingId || word.rubyUnits.some(unit => unit.id === syncEditingId)) ? syncEditingId : null,
          syncCursor?.lineId === line.id ? [syncCursor, syncProgress] : null,
          editing.ignoredSyncLineIds.includes(line.id), line.words.map(word => [editing.emptyBeats[word.id], word.rubyUnits.map(unit => editing.emptyBeats[unit.id])]),
          drag.placeholders?.ids ? [...drag.placeholders.ids] : null,
        ])} pinnedLineIds={document.lines.filter(line => line.id === wordDraft?.lineId || line.words.some(word => word.id === syncEditingId || word.id === rubyShortcut?.wordId || word.rubyUnits.some(unit => unit.id === syncEditingId))).map(line => line.id)} key={mode} memory={listMemory.current[mode]} lines={displayed.lines} locate={locate} append={() => {
          const line = createLine('');
          if (dispatch({ type: 'insert-line', afterLineId: mainLines.at(-1)?.id ?? null, line })) {
            setSelection({ kind: 'lines', ids: [line.id], anchorId: line.id, activeId: line.id });
            props.onSelectLine?.(line.id); requestLocate(line.id);
          }
        }} renderLine={(line) => mode === 'sync' || mode === 'karaoke' ? <SyncLine karaoke={mode==='karaoke'&&props.project ? {
          add:<button data-role="inline" aria-label="添加行前导唱" onClick={()=>insertKaraoke({kind:'insert',anchor:{kind:'before',lineId:line.id}})}>＋</button>,
          before:<CueSlot project={props.project} anchor={{kind:'before',lineId:line.id}} apply={applyKaraokeCommand}/>,
          gap:(leftId,rightId,wordId)=><CueSlot project={props.project!} anchor={wordId?{kind:'ruby',lineId:line.id,wordId,leftId,rightId}:{kind:'word',lineId:line.id,leftId,rightId}} apply={applyKaraokeCommand}/>
        }:undefined} key={line.id} line={line} ordinal={ordinalById.get(line.backgroundOf ?? line.id)} gutterDigits={String(mainLines.length).length} editing={editing} selection={selection} cursor={syncCursor} progress={syncProgress}
          draft={{ id: syncEditingId, commit: syncDraftCommit, open: id => { if (finishSyncDraft()) setSyncEditingId(id); }, close: () => setSyncEditingId(null) }} apply={dispatch}
          selectLine={(shift, toggle) => selectLine(line, shift, toggle)} selectWord={(word, shift, toggle) => selectWord(line, word, shift, toggle)} selectRuby={(word, id, shift, toggle) => selectRuby(line, word, id, shift, toggle)}
          renderWordDraft={after => renderWordDraft(line, after)} addWord={() => startWordDraft(line.id, line.words.at(-1)?.id ?? null)} rubyDraft={rubyShortcut} closeRubyDraft={() => setRubyShortcut(null)} placeholder={drag.isPlaceholder}/>
          : <LyricLineView key={line.id} line={line} placeholder={drag.isPlaceholder('line', line.backgroundOf ?? line.id)}
          selected={selection?.kind === 'lines' && selection.ids.includes(line.id)}
          playhead={props.playheadLineId === line.id}
          onSelect={(shift, toggle) => selectLine(line, shift, toggle)} onMove={(direction) => moveLine(line, direction)}>
          <div className={styles.lineHeader}><span>L{ordinalById.get(line.backgroundOf ?? line.id)} · {line.backgroundOf ? '背景' : '主唱'}</span></div>
          <div className={styles.words}>{renderWordDraft(line, null)}{line.words.map(word => <Fragment key={word.id}>{wordView(line, word)}{renderWordDraft(line, word.id)}</Fragment>)}
            <button data-role="inline" className="icon-button" title="添加词" data-tooltip="添加词" aria-label="添加词" onClick={event => { event.stopPropagation(); startWordDraft(line.id, line.words.at(-1)?.id ?? null); }}><Icon name="add"/></button>
          </div>
          <TranslationEditor document={document} lineId={line.id} apply={dispatch} />
          <div className={styles.romanizationTracks}>
            {displayed.romanizationTracks.map((track, trackIndex) => {
              const contents = track.contents.filter((content) => content.lineId === line.id);
              return <div key={track.id}>
                <div className={styles.romanizationTrackHeader}>
                  <span>L{ordinalById.get(line.backgroundOf ?? line.id)}{line.backgroundOf ? ' · 背景' : ''} · 音译轨道 {trackIndex + 1} · {track.language ?? '未指定语言'}</span>
                  <button data-role="secondary" onClick={() => dispatch({ type: 'insert-romanization-content', trackId: track.id, content: { id: crypto.randomUUID(), lineId: line.id, kind: 'plain', text: '' } })}>添加音译</button>
                </div>
                {contents.map((content) => <RomanizationRow key={content.id} track={track} content={content}
                    placeholder={drag.isPlaceholder('romanization-content', content.id)} placeholderUnitIds={drag.placeholders?.kind === 'romanization-unit' ? drag.placeholders.ids : undefined}
                    selectedContent={selection?.kind === 'romanization-content' && selection.ids.includes(content.id)}
                    selectedUnitIds={selection?.kind === 'romanization-unit' ? selection.ids : []}
                    selectContent={(shift, toggle) => selectRomanizationContent(line.id, track.id, content.id, shift, toggle)}
                    selectUnit={(unitId, shift, toggle) => selectRomanizationUnit(line.id, track.id, content.id, unitId, shift, toggle)} apply={dispatch} />)}
              </div>;
            })}
          </div>
        </LyricLineView>} />
      </main>
      {columns.inspectorVisible && separator('inspector')}{columns.inspectorVisible && <aside ref={inspectorRef} className={styles.inspector}><h2>属性</h2><div className={styles.panelBody}>{mode==='karaoke'&&cue&&props.project&&<CueProperties key={cue.id} project={props.project} cue={cue} apply={applyKaraokeCommand}/>} {selectedLine && !(mode==='karaoke'&&cue) && <>
        <p>{selection?.kind === 'lines' ? '已选行' : '所在行'}：{selection?.kind === 'lines' && selection.ids.length > 1 ? `${selection.ids.length} 行` : `L${ordinalById.get(selectedLine.backgroundOf ?? selectedLine.id)}${selectedLine.backgroundOf ? ' · 背景' : ''}`}</p>
        {selection?.kind === 'lines' && selection.ids.length > 1 && <p className={styles.fieldContext}>当前行 L{ordinalById.get(selectedLine.backgroundOf ?? selectedLine.id)}</p>}
        {activePropertyTarget && activePropertyTarget.kind !== 'line' && activePropertyInterval && <>
          <p>{selection?.kind === 'words' ? '词' : selection?.kind === 'ruby' ? '注音' : '音译单元'}：已选 {selection?.ids.length}</p>
          {selection?.ids.length === 1 && propertyText !== undefined && <p className={styles.propertyQuote}>{propertyText}</p>}
          {selection?.ids.length === 1 ? <TimePair begin={activePropertyInterval.beginMs} end={activePropertyInterval.endMs} label="选中对象" onCommit={(beginMs, endMs) => {
            const target = activePropertyTarget;
            if (target.kind === 'word') dispatch({ type: 'set-word-time', lineId: target.lineId, wordId: target.wordId, beginMs, endMs });
            else if (target.kind === 'ruby') dispatch({ type: 'set-ruby-time', lineId: target.lineId, wordId: target.wordId, rubyId: target.rubyId, beginMs, endMs });
            else if (target.kind === 'romanization') { const content = document.romanizationTracks.find(track => track.id === target.trackId)!.contents.find(content => content.id === target.contentId)!; if (content.kind === 'timed') dispatch({ type: 'set-romanization-content', trackId: target.trackId, content: { ...content, units: content.units.map(unit => unit.id === target.unitId ? { ...unit, beginMs, endMs } : unit) } }); }
          }} /> : <small>多对象时间可在时间轴整体平移；端点请单独调整。</small>}
        </>}
        {selection?.ids.length === 1 && activePropertyTarget && propertyWord && (activePropertyTarget.kind === 'ruby' || activePropertyTarget.kind === 'word' && propertyWord.rubyUnits.length === 0) && <EmptyBeatField
          key={targetId(activePropertyTarget)} count={emptyBeatCount(editing, targetId(activePropertyTarget))} whitespace={!propertyText?.trim()}
          commit={count => dispatch({ type: 'set-empty-beat', kind: activePropertyTarget.kind as 'ruby' | 'word', id: targetId(activePropertyTarget), count })}/>}
        {selection?.kind === 'words' && selection.ids.length === 1 && propertyWord && activePropertyTarget?.kind === 'word' && <BooleanField label="不雅用语" switchControl checked={propertyWord.obscene} onChange={obscene => dispatch({ type: 'set-word-obscene', lineId: activePropertyTarget.lineId, wordId: propertyWord.id, obscene })}/>}
        {selection?.kind==='words'&&selection.ids.length===1&&propertyWord&&activePropertyTarget?.kind==='word'&&<fieldset className={styles.singerSelection} disabled={props.project?.amll.noWordAgents}><legend>词级歌手</legend>{document.agents.map(agent=><label key={agent.id}><input type="checkbox" aria-label={`词级歌手 ${agent.name??agent.id}`} checked={propertyWord.agentRefs?.includes(agent.id)??false} onChange={event=>dispatch({type:'set-word-agents',lineId:activePropertyTarget.lineId,wordId:propertyWord.id,agentRefs:event.target.checked?[...(propertyWord.agentRefs??[]),agent.id]:(propertyWord.agentRefs??[]).filter(id=>id!==agent.id)})}/>{agent.name??agent.id}</label>)}</fieldset>}
        {selection?.kind === 'lines' && <>
        {mode==='karaoke'&&props.project&&<label>输出分组<Select aria-label="输出分组" value={new Set(propertyLines.map(l=>props.project!.karaoke.lineGroups[l.id])).size===1?props.project.karaoke.lineGroups[propertyLines[0]?.id]??'':''} onChange={e=>insertKaraoke({kind:'assign',lineIds:propertyLines.map(l=>l.id),groupId:e.target.value})}><option value="">{propertyLines.length>1?'多个值':'请选择分组'}</option>{props.project.karaoke.groups.map(g=><option key={g.id} value={g.id}>{g.name}</option>)}</Select></label>}
        {selection.ids.length === 1 && <TimePair begin={selectedLine.beginMs} end={selectedLine.endMs} label={`行 ${selectedLine.id}`} onCommit={(beginMs, endMs) => dispatch({ type: 'set-line-time', lineId: selectedLine.id, beginMs, endMs })} />}
        {selection?.kind === 'lines' && selection.ids.length > 1 && <small>多行时间请使用整体偏移或时间轴平移。</small>}
        {propertyLines.length > 0 && <>
          <BooleanField label="跳过对齐" switchControl={!(selection?.kind === 'lines' && selection.ids.length > 1)} checked={propertyLines.every(line => editing.skippedAlignmentLineIds.includes(line.id))} mixed={propertyLines.some(line => editing.skippedAlignmentLineIds.includes(line.id)) && !propertyLines.every(line => editing.skippedAlignmentLineIds.includes(line.id))} onChange={checked => dispatch({type:'batch', commands:propertyLines.map(line=>({type:'set-skip-alignment',lineId:line.id,skip:checked}))})}/>
          <BooleanField label="跳过打轴" switchControl={!(selection?.kind === 'lines' && selection.ids.length > 1)} checked={propertyLines.every(line => editing.ignoredSyncLineIds.includes(line.id))} mixed={propertyLines.some(line => editing.ignoredSyncLineIds.includes(line.id)) && !propertyLines.every(line => editing.ignoredSyncLineIds.includes(line.id))} onChange={checked => dispatch({type:'batch', commands:propertyLines.map(line=>({type:'set-ignore-sync',lineId:line.id,ignoreSync:checked}))})}/>
        </>}
        {props.project?.amll.simplified ? selectedMainLines.map(line=><BooleanField key={line.id} label="对唱歌词" switchControl checked={line.agentRefs.includes('v2')} onChange={duet=>props.applyProject?.({type:'duet',lineId:line.id,duet})}/>) : <SingerSelection agents={document.agents} lines={propertyLines} apply={dispatch} />}
        {selectedLine.backgroundOf&&props.project&&<BooleanField label="背景置于主行之前" switchControl checked={displayOrder.indexOf(selectedLine)<displayOrder.findIndex(line=>line.id===selectedLine.backgroundOf)} onChange={before=>props.applyProject?.({type:'background-position',lineId:selectedLine.id,before})}/>}
        {selection?.kind !== 'lines' || selection.ids.length <= 1 ? <>
          <BooleanField label="背景歌词" switchControl checked={Boolean(selectedLine.backgroundOf)} onChange={(checked) => {
            if (!checked) { dispatch({ type: 'set-background-of', lineId: selectedLine.id, parentLineId: null }); return; }
            const index = document.lines.findIndex(line => line.id === selectedLine.id);
            const preceding = document.lines.slice(0, index).filter(line => !line.backgroundOf).at(-1);
            if (!preceding) { setMessage('此行之前没有主行，不能设为背景歌词'); return; }
            if (props.project?.amll.noMultipleBackgrounds && document.lines.some(line => line.backgroundOf === preceding.id)) { setMessage('前一主行已有背景歌词，请先处理所属关系'); return; }
            dispatch({ type: 'set-background-of', lineId: selectedLine.id, parentLineId: preceding.id });
          }} />
          <label>所属主行 <Select disabled={!selectedLine.backgroundOf} value={selectedLine.backgroundOf ?? ''} onChange={(event) => {
            if (selectedLine.backgroundOf) dispatch({ type: 'set-background-of', lineId: selectedLine.id, parentLineId: event.target.value });
          }}>
            <option value="">请选择</option>{mainLines.filter((line) => line.id !== selectedLine.id && !occupiedParents.has(line.id)).map((line) => <option key={line.id} value={line.id}>L{ordinalById.get(line.id)}</option>)}
          </Select></label>
        </> : null}
        </>}
      </>}
      </div></aside>}</div>}
    {settingsDialog === 'translations' && <TranslationTrackDialog document={document} apply={dispatch} close={() => setSettingsDialog(null)} />}
    {settingsDialog === 'metadata' && <SettingsDialog title="歌词元数据" close={() => setSettingsDialog(null)}><MetadataPanel document={document} apply={dispatch} /></SettingsDialog>}
    {amllOpen&&props.project&&props.applyProject&&<SettingsDialog title="AMLL 兼容设置" subtitle="当前项目 · 修改立即生效并自动保存，可撤销" close={()=>setAmllOpen(false)}
      returnFocus={()=>amllNavigating.current?null:pageRef.current?.querySelector<HTMLElement>('[data-top-menu="settings"] > summary')??null}
      actions={<button data-role="secondary" onClick={()=>setAmllOpen(false)}>关闭</button>}>
      <AmllSettings project={props.project} apply={command=>{try{props.applyProject!(command);}catch(e){setMessage(e instanceof Error?e.message:String(e));}}}
        locate={rule=>{amllNavigating.current=true;setAmllOpen(false);setValidationTab('amll');setFocusRule(rule);setMode('package');}}/>
    </SettingsDialog>}
    {settingsDialog === 'singers' && !props.project?.amll.simplified && <SingerDialog focusAgent={focusAgent} document={document} apply={dispatch} close={() => setSettingsDialog(null)} />}
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
        <label>目标歌词行 <Select value={contentTransfer.targetLineId} onChange={(event) => setContentTransfer({ ...contentTransfer, targetLineId: event.target.value })}>
          {document.lines.filter((line) => line.id !== content.lineId).map((line) => <option key={line.id} value={line.id}>{line.backgroundOf ? '背景 · ' : ''}{lineText(line) || '空行'}</option>)}
        </Select></label>
        <p>文字与独立时间保持原值，所属行会改变。</p>

      </SettingsDialog>;
    })()}
    {segmentationOpen && <SegmentationPanel document={document} selection={selection} currentLineId={selectedLine?.id ?? null} apply={dispatch} close={() => setSegmentationOpen(false)} />}
    {batchToolsOpen && <BatchToolsPanel document={document} selection={selection} currentLineId={selectedLine?.id ?? null} apply={dispatch} close={() => setBatchToolsOpen(false)} />}
    {romanizationGeneration && <RomanizationGenerationDialog document={document} lineIds={romanizationGeneration}
      preferenceScope={props.projectId ? `project:${props.projectId}` : `local:${props.title}`} apply={dispatch} close={() => setRomanizationGeneration(null)} />}
    {japaneseRuby && <JapaneseRubyDialog document={document} lineIds={japaneseRuby} apply={dispatch} close={() => setJapaneseRuby(null)} />}
    {rubyGeneration && <RubyGenerationDialog document={document} lineIds={rubyGeneration.lineIds} initialTrackId={rubyGeneration.trackId} initialContentId={rubyGeneration.contentId}
      apply={dispatch} close={() => setRubyGeneration(null)} />}
    {splitLineId && document.lines.find((line) => line.id === splitLineId) && <LineSplitDialog translations={translationsForLine(document, splitLineId)} key={splitLineId} line={document.lines.find((line) => line.id === splitLineId)!}
      backgrounds={document.lines.filter((line) => line.backgroundOf === splitLineId)}
      attached={document.romanizationTracks.flatMap((track) => track.contents.filter((content) => content.lineId === splitLineId).map((content) => ({ track, content })))}
      close={() => setSplitLineId(null)}
      submit={plan => dispatch({ type: 'split-line', ...plan })} />}
    {contextMenu && <EditorContextMenu x={contextMenu.x} y={contextMenu.y} title={contextMenu.title} actions={contextMenu.actions} close={closeContext} />}
    </fieldset>
  </div>;
}
