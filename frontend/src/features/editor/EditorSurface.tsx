import { useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { LyricCommand } from '../../domain/lyric-commands';
import { createLine, createWord, lineText, type LyricDocument, type LyricLine, type LyricWord, type TimeUs } from '../../domain/lyric-document';
import { utf16ToCodePoint } from '../../domain/text-boundaries';
import { copySelection, cutSelection, invertIds, moveWordsAcrossLine, pastePlain, pasteRich, selectIds, type EditorClipboard, type EditorSelection } from './editing-actions';
import styles from './semantic-editor.module.css';

const CLIPBOARD_MIME = 'application/x-lazulite-lyric';

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
  auxiliary?: ReactNode;
  selectedLineId?: string | null;
  playheadLineId?: string | null;
  onSelectLine?: (id: string) => void;
};

function seconds(value: TimeUs) { return value === null ? '' : String(value / 1_000_000); }
function parseSeconds(value: string): TimeUs {
  if (!value.trim()) return null;
  if (!/^\d+(?:\.\d+)?$/.test(value.trim())) throw new Error('时间必须是非负秒数');
  const number = Math.round(Number(value) * 1_000_000);
  if (!Number.isSafeInteger(number)) throw new Error('时间超出微秒精度范围');
  return number;
}

function isTextInput(target: EventTarget) {
  return target instanceof Element && Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
}

function DraftInput({ value, label, onCommit, onFocus, onSplit, onMove, onNavigate, inputRef }: { value: string; label: string; onCommit: (value: string) => void; onFocus?: () => void; onSplit?: (at: number) => void; onMove?: (direction: -1 | 1) => void; onNavigate?: (direction: -1 | 1) => void; inputRef?: (node: HTMLInputElement | null) => void }) {
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLInputElement>(null);
  const composing = useRef(false);
  const cancelled = useRef(false);
  useEffect(() => setDraft(value), [value]);
  return <input ref={(node) => { ref.current = node; inputRef?.(node); }} aria-label={label} value={draft} onChange={(event) => setDraft(event.target.value)} onFocus={onFocus}
    onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
    onBlur={() => { if (cancelled.current) { cancelled.current = false; return; } if (draft !== value) onCommit(draft); }}
    onKeyDown={(event) => {
      if (composing.current) return;
      if (event.key === 'Enter') ref.current?.blur();
      if (event.key === 'Escape') { cancelled.current = true; setDraft(value); ref.current?.blur(); }
      if (event.key === 'F8' && onSplit) { event.preventDefault(); onSplit(ref.current?.selectionStart ?? 0); }
      if (event.altKey && onMove && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) { event.preventDefault(); onMove(event.key === 'ArrowLeft' ? -1 : 1); }
      if (event.altKey && onNavigate && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) { event.preventDefault(); onNavigate(event.key === 'ArrowUp' ? -1 : 1); }
    }} />;
}

function TimePair({ begin, end, label, onCommit }: { begin: TimeUs; end: TimeUs; label: string; onCommit: (begin: TimeUs, end: TimeUs) => void }) {
  const [start, setStart] = useState(seconds(begin));
  const [finish, setFinish] = useState(seconds(end));
  useEffect(() => { setStart(seconds(begin)); setFinish(seconds(end)); }, [begin, end]);
  const commit = () => {
    const nextBegin = parseSeconds(start), nextEnd = parseSeconds(finish);
    if (nextBegin !== begin || nextEnd !== end) onCommit(nextBegin, nextEnd);
  };
  return <span className={styles.times}><input aria-label={`${label}开始秒数`} inputMode="decimal" value={start} onChange={(event) => setStart(event.target.value)} onBlur={commit} /><span>–</span><input aria-label={`${label}结束秒数`} inputMode="decimal" value={finish} onChange={(event) => setFinish(event.target.value)} onBlur={commit} /></span>;
}

export function EditorSurface(props: Props) {
  const { document, apply } = props;
  const [selection, setSelection] = useState<EditorSelection | null>(null);
  const [clipboard, setClipboard] = useState<EditorClipboard | null>(null);
  const clipboardToken = useRef('');
  const dragging = useRef<{ kind: 'line'; lineId: string } | { kind: 'word'; lineId: string; wordId: string } | null>(null);
  const wordInputs = useRef(new Map<string, HTMLInputElement>());
  const [simpleLayout, setSimpleLayout] = useState(false);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  useEffect(() => {
    setSelection((current) => {
      if (!current) return current;
      if (current.kind === 'lines') {
        const order = document.lines.filter((line) => !line.backgroundOf).map((line) => line.id);
        const ids = current.ids.filter((id) => order.includes(id));
        if (ids.length === current.ids.length && (current.activeId === '' || document.lines.some((line) => line.id === current.activeId))) return current;
        return { ...current, ids, anchorId: order.includes(current.anchorId) ? current.anchorId : ids[0] ?? '', activeId: document.lines.some((line) => line.id === current.activeId) ? current.activeId : ids.at(-1) ?? '' };
      }
      const line = document.lines.find((item) => item.id === current.lineId);
      const ids = current.ids.filter((id) => line?.words.some((word) => word.id === id));
      if (line && ids.length === current.ids.length && (!current.rubyId || line.words.some((word) => word.rubyUnits.some((unit) => unit.id === current.rubyId)))) return current;
      return line ? { ...current, ids, anchorId: line.words.some((word) => word.id === current.anchorId) ? current.anchorId : ids[0] ?? '', activeId: ids.includes(current.activeId) ? current.activeId : ids.at(-1) ?? '', rubyId: null }
        : { kind: 'lines', ids: [], anchorId: '', activeId: '' };
    });
  }, [document]);
  const activeLineId = selection?.kind === 'words' ? selection.lineId : selection?.activeId || props.selectedLineId;
  const selectedLine = document.lines.find((line) => line.id === activeLineId) ?? document.lines[0];
  const mainLines = document.lines.filter((line) => !line.backgroundOf);
  const mainIds = mainLines.map((line) => line.id);
  const selectLine = (line: LyricLine, shift = false, toggle = false) => {
    const id = line.backgroundOf ?? line.id;
    const previous = selection?.kind === 'lines' ? selection : null;
    const ids = selectIds(mainIds, previous?.ids ?? [], previous?.anchorId ?? id, id, shift, toggle);
    setSelection({ kind: 'lines', ids, anchorId: shift || toggle ? previous?.anchorId ?? id : id, activeId: line.id });
    props.onSelectLine?.(line.id);
  };
  const selectWord = (line: LyricLine, word: LyricWord, shift = false, toggle = false, rubyId: string | null = null) => {
    const previous = selection?.kind === 'words' && selection.lineId === line.id ? selection : null;
    const ids = selectIds(line.words.map((item) => item.id), previous?.ids ?? [], previous?.anchorId ?? word.id, word.id, shift, toggle);
    setSelection({ kind: 'words', lineId: line.id, ids, anchorId: shift || toggle ? previous?.anchorId ?? word.id : word.id, activeId: word.id, rubyId });
    props.onSelectLine?.(line.id);
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
    if (dispatch(cutSelection(current))) {
      setClipboard(next);
      clipboardToken.current = crypto.randomUUID();
      const available = current.kind === 'words' ? current.lineId : mainIds.filter((id) => !current.ids.includes(id)).at(-1);
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
    if (selection?.kind === 'words') {
      const line = document.lines.find((item) => item.id === selection.lineId)!;
      const order = line.words.map((word) => word.id);
      const ids = invert ? invertIds(order, selection.ids) : order;
      setSelection({ ...selection, ids, anchorId: ids[0] ?? '', activeId: ids.at(-1) ?? '' });
    } else {
      const ids = invert ? invertIds(mainIds, selection?.kind === 'lines' ? selection.ids : []) : mainIds;
      setSelection({ kind: 'lines', ids, anchorId: ids[0] ?? '', activeId: ids.at(-1) ?? '' });
    }
  };
  const moveSelectedWords = (direction: -1 | 1) => {
    if (selection?.kind !== 'words' || !selection.ids.length) return;
    const target = document.lines[document.lines.findIndex((line) => line.id === selection.lineId) + direction];
    if (!target) return;
    try {
      if (dispatch(moveWordsAcrossLine(document, selection, target.id))) {
        setSelection({ ...selection, lineId: target.id, rubyId: null });
        props.onSelectLine?.(target.id);
      }
    } catch (error) { setMessage(error instanceof Error ? error.message : '跨行移动失败'); }
  };
  const startDrag = (event: DragEvent, source: NonNullable<typeof dragging.current>) => {
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
  const dropLine = (event: DragEvent, target: LyricLine) => {
    const source = dragging.current;
    if (!source) return;
    event.preventDefault(); event.stopPropagation();
    dragging.current = null; setDropTarget(null);
    const targetId = target.backgroundOf ?? target.id;
    if (source.kind === 'line') {
      if (source.lineId === targetId) return;
      if (event.ctrlKey || event.metaKey) {
        const item = copySelection(document, { kind: 'lines', ids: [source.lineId], anchorId: source.lineId, activeId: source.lineId });
        const result = pasteRich(document, item, { kind: 'lines', ids: [targetId], anchorId: targetId, activeId: targetId });
        if (dispatch(result.command)) setSelection(result.selection);
      } else if (dispatch({ type: 'move-line', lineId: source.lineId, afterLineId: targetId })) setSelection({ kind: 'lines', ids: [source.lineId], anchorId: source.lineId, activeId: source.lineId });
      return;
    }
    dropWord(event, target, target.words.at(-1)?.id ?? null, source);
  };
  const dropWord = (event: DragEvent, targetLine: LyricLine, afterWordId: string | null, source = dragging.current) => {
    if (!source || source.kind !== 'word') return;
    event.preventDefault(); event.stopPropagation();
    dragging.current = null; setDropTarget(null);
    if (source.lineId === targetLine.id && source.wordId === afterWordId) return;
    const sourceSelection: Extract<EditorSelection, { kind: 'words' }> = { kind: 'words', lineId: source.lineId, ids: [source.wordId], anchorId: source.wordId, activeId: source.wordId, rubyId: null };
    if (event.ctrlKey || event.metaKey) {
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
  const sublyric = (line: LyricLine, kind: 'translations' | 'romanizations', index: number, text: string) => {
    const items = line[kind].map((item, i) => i === index ? { ...item, text } : item);
    dispatch({ type: 'set-sublyrics', lineId: line.id, kind, items });
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
    const order = document.lines.flatMap((line) => line.words.map((word) => word.id));
    const target = order[order.indexOf(wordId) + direction];
    if (target) wordInputs.current.get(target)?.focus();
  };
  const wordView = (line: LyricLine, word: LyricWord, index: number) => <div className={`${styles.word} ${selection?.kind === 'words' && selection.ids.includes(word.id) ? styles.selectedWord : ''} ${dropTarget === `word:${word.id}` ? styles.dropWord : ''}`} key={word.id} data-word-id={word.id} tabIndex={0}
    onFocus={(event) => { if (event.target === event.currentTarget) selectWord(line, word); }}
    onMouseDown={(event) => { if ((event.target as Element).closest('[draggable="true"]')) return; if (event.shiftKey || event.ctrlKey || event.metaKey) { event.preventDefault(); selectWord(line, word, event.shiftKey, event.ctrlKey || event.metaKey); } }}
    onClick={(event) => { if (!event.shiftKey && !event.ctrlKey && !event.metaKey && !(event.target as Element).closest('[data-ruby-id],button')) selectWord(line, word); }}
    onDragOver={(event) => { if (dragging.current?.kind === 'word') overDrop(event, `word:${word.id}`); }} onDrop={(event) => dropWord(event, line, word.id)}>
    <div className={styles.wordMain}>
      <button className={styles.dragHandle} draggable aria-label={`拖动词 ${word.text}`} title="拖放排序；按 Ctrl 复制" onDragStart={(event) => startDrag(event, { kind: 'word', lineId: line.id, wordId: word.id })} onDragEnd={() => { dragging.current = null; setDropTarget(null); }}>⋮⋮</button>
      <DraftInput value={word.text} label={`词 ${word.text}`} onFocus={() => selectWord(line, word)}
        onCommit={(text) => dispatch({ type: 'edit-word', lineId: line.id, wordId: word.id, text })}
        onSplit={(at) => dispatch({ type: 'split-word', lineId: line.id, wordId: word.id, at: utf16ToCodePoint(word.text, at) })}
        onMove={(direction) => moveWord(line, word, direction)} onNavigate={(direction) => navigateWord(word.id, direction)}
        inputRef={(node) => { if (node) wordInputs.current.set(word.id, node); else wordInputs.current.delete(word.id); }} />
      <button aria-label={`词前移 ${word.text}`} disabled={index === 0} onClick={() => moveWord(line, word, -1)}>←</button>
      <button aria-label={`词后移 ${word.text}`} disabled={index === line.words.length - 1} onClick={() => moveWord(line, word, 1)}>→</button>
      <button aria-label={`拆分词 ${word.text}`} title="按光标位置拆分；输入中可按 F8" onClick={() => {
        const at = Math.floor(Array.from(word.text).length / 2);
        dispatch({ type: 'split-word', lineId: line.id, wordId: word.id, at });
      }}>拆</button>
      <button aria-label={`删除词 ${word.text}`} onClick={() => dispatch({ type: 'delete-word', lineId: line.id, wordId: word.id })}>×</button>
    </div>
    <TimePair begin={word.beginUs} end={word.endUs} label={`词 ${word.text}`} onCommit={(beginUs, endUs) => dispatch({ type: 'set-word-time', lineId: line.id, wordId: word.id, beginUs, endUs })} />
    <div className={styles.rubies}>{word.rubyUnits.map((unit) => <div key={unit.id} data-ruby-id={unit.id} className={`${styles.ruby} ${selection?.kind === 'words' && selection.rubyId === unit.id ? styles.selectedRuby : ''}`}>
      <DraftInput value={unit.reading} label={`读音 ${word.text}`} onFocus={() => selectWord(line, word, false, false, unit.id)}
        onCommit={(reading) => dispatch({ type: 'edit-ruby', lineId: line.id, wordId: word.id, rubyId: unit.id, reading })} />
      <button aria-label={`删除读音 ${unit.reading}`} onClick={() => dispatch({ type: 'delete-ruby', lineId: line.id, wordId: word.id, rubyId: unit.id })}>×</button>
      <TimePair begin={unit.beginUs} end={unit.endUs} label={`读音 ${unit.reading}`} onCommit={(beginUs, endUs) => dispatch({ type: 'set-ruby-time', lineId: line.id, wordId: word.id, rubyId: unit.id, beginUs, endUs })} />
    </div>)}<button onClick={() => { const reading = window.prompt('输入读音'); if (reading) dispatch({ type: 'add-ruby', lineId: line.id, wordId: word.id, reading }); }}>加读音</button></div>
  </div>;
  return <div className={styles.page} onCopy={(event) => {
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
    <header className={styles.header}><Link to="/projects" className={styles.brand}>Lazulite Studio</Link><strong>{props.title}</strong><span>{props.saving ? '保存中' : props.dirty ? '未保存' : '已保存'}</span>
      <div className={styles.actions}>{props.onOpen && <label>打开 TTML<input type="file" accept=".ttml,.xml" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) props.onOpen?.(file); event.target.value = ''; }} /></label>}{props.onNew && <button onClick={props.onNew}>新建</button>}<button onClick={props.onSave} disabled={props.saving}>保存</button><button onClick={props.undo} disabled={!props.canUndo}>撤销</button><button onClick={props.redo} disabled={!props.canRedo}>重做</button><button onClick={() => setSimpleLayout((value) => !value)}>{simpleLayout ? '高级布局' : '简单布局'}</button><button onClick={props.onDraft}>下载草稿</button><button onClick={props.onFinal}>最终 TTML</button></div>
    </header>
    {(message || props.error) && <p role="alert" className={styles.error}>{message || props.error}</p>}
    <div className={styles.ribbon} aria-label="编辑操作"><span>{selection ? `${selection.kind === 'words' ? '词' : '行'}已选 ${selection.ids.length}` : '当前行'}</span>
      <button onClick={() => copy()} disabled={selection?.ids.length === 0}>复制</button><button onClick={() => cut()} disabled={selection?.ids.length === 0}>剪切</button>
      <button onClick={() => paste(clipboard)} disabled={!clipboard}>粘贴</button><button onClick={() => selectAll(false)}>全选</button><button onClick={() => selectAll(true)}>反选</button>
      <button onClick={() => setSelection({ kind: 'lines', ids: [], anchorId: '', activeId: '' })}>清空选择</button>
      <button disabled={selection?.kind !== 'words' || !selection.ids.length || document.lines.findIndex((line) => line.id === selection.lineId) === 0} onClick={() => moveSelectedWords(-1)}>词移上行</button>
      <button disabled={selection?.kind !== 'words' || !selection.ids.length || document.lines.findIndex((line) => line.id === selection.lineId) === document.lines.length - 1} onClick={() => moveSelectedWords(1)}>词移下行</button>
      <small>非输入框内 Ctrl/Cmd+C、X、V 使用词块剪贴板；Alt+↑/↓ 切词；外部纯文本按行插入。</small>
    </div>
    <div className={`${styles.layout} ${simpleLayout ? styles.simpleLayout : ''}`}><aside className={styles.outline}><h2>大纲</h2>{document.lines.map((line, index) => <button key={line.id} className={selection?.kind === 'lines' ? selection.ids.includes(line.backgroundOf ?? line.id) ? styles.selected : '' : selectedLine?.id === line.id ? styles.selected : ''} onClick={(event) => selectLine(line, event.shiftKey, event.ctrlKey || event.metaKey)}>{index + 1} {line.backgroundOf ? '↳ ' : ''}{lineText(line) || '空行'}</button>)}</aside>
      <main className={styles.canvas}><div className={styles.canvasHeader}><h1>歌词编辑</h1><button onClick={() => dispatch({ type: 'insert-line', afterLineId: document.lines.at(-1)?.id ?? null })}>新增歌词行</button></div>
        {document.lines.map((line) => <section className={`${styles.line} ${selection ? selection.kind === 'lines' ? selection.ids.includes(line.backgroundOf ?? line.id) ? styles.selectedLine : '' : selection.lineId === line.id ? styles.selectedLine : '' : selectedLine?.id === line.id ? styles.selectedLine : ''} ${props.playheadLineId === line.id ? styles.playheadLine : ''} ${dropTarget === `line:${line.id}` ? styles.dropLine : ''}`} key={line.id} data-line-id={line.id} tabIndex={0} aria-label={`歌词行 ${lineText(line) || '空行'}`} onClick={(event) => { if (!(event.target as Element).closest('[data-word-id]')) selectLine(line, event.shiftKey, event.ctrlKey || event.metaKey); }} onDragOver={(event) => overDrop(event, `line:${line.id}`)} onDrop={(event) => dropLine(event, line)} onKeyDown={(event) => {
          if (event.target !== event.currentTarget || event.nativeEvent.isComposing || !event.altKey) return;
          if (event.key === 'ArrowUp' || event.key === 'ArrowDown') { event.preventDefault(); moveLine(line, event.key === 'ArrowUp' ? -1 : 1); }
        }}>
          <div className={styles.lineHeader}>{!line.backgroundOf && <button className={styles.dragHandle} draggable aria-label={`拖动行 ${lineText(line)}`} title="拖放排序；按 Ctrl 复制" onDragStart={(event) => startDrag(event, { kind: 'line', lineId: line.id })} onDragEnd={() => { dragging.current = null; setDropTarget(null); }}>⋮⋮</button>}<span>{line.backgroundOf ? '背景' : '主唱'} · {line.id}</span><TimePair begin={line.beginUs} end={line.endUs} label={`行 ${line.id}`} onCommit={(beginUs, endUs) => dispatch({ type: 'set-line-time', lineId: line.id, beginUs, endUs })} />
            {!line.backgroundOf && <><button aria-label={`行上移 ${lineText(line)}`} disabled={mainLines[0]?.id === line.id} onClick={() => moveLine(line, -1)}>↑</button><button aria-label={`行下移 ${lineText(line)}`} disabled={mainLines.at(-1)?.id === line.id} onClick={() => moveLine(line, 1)}>↓</button></>}
            <button onClick={() => dispatch({ type: 'insert-line', afterLineId: line.backgroundOf ?? line.id })}>后插行</button><button onClick={() => dispatch({ type: 'delete-line', lineId: line.id })}>删行</button></div>
          <div className={styles.words}>{line.words.map((word, index) => wordView(line, word, index))}<button onClick={() => dispatch({ type: 'insert-word', lineId: line.id, afterWordId: line.words.at(-1)?.id ?? null, word: createWord('新词') })}>加词</button></div>
          {!line.backgroundOf && <div className={styles.sublyrics}>{(['translations', 'romanizations'] as const).map((kind) => <div key={kind}><strong>{kind === 'translations' ? '翻译' : '音译'}</strong>{line[kind].map((item, index) => <div key={index}><DraftInput value={item.text} label={`${kind === 'translations' ? '翻译' : '音译'} ${index + 1}`} onCommit={(text) => sublyric(line, kind, index, text)} /><small>{item.language ?? '未指定语言'}</small></div>)}<button onClick={() => dispatch({ type: 'set-sublyrics', lineId: line.id, kind, items: [...line[kind], { language: null, text: '' }] })}>添加</button></div>)}</div>}
        </section>)}
      </main>
      <aside className={styles.inspector}><h2>属性</h2>{selectedLine && <><p>已选行：{lineText(selectedLine) || '空行'}</p>{!selectedLine.backgroundOf && <><label>歌手 <select value={selectedLine.agentRefs[0] ?? ''} onChange={(event) => dispatch({ type: 'set-line-agents', lineId: selectedLine.id, agentRefs: event.target.value ? [event.target.value] : [] })}><option value="">未指定</option>{document.agents.map((agent) => <option value={agent.id} key={agent.id}>{agent.name ?? agent.id}</option>)}</select></label><button onClick={() => dispatch({ type: 'insert-background', parentLineId: selectedLine.id, line: createLine('背景歌词') })} disabled={document.lines.some((line) => line.backgroundOf === selectedLine.id)}>添加背景歌词</button></>}</>}
        <h2>歌手</h2>{document.agents.map((agent) => <div key={agent.id}><strong>{agent.id}</strong><DraftInput value={agent.name ?? ''} label={`歌手 ${agent.id}`} onCommit={(name) => dispatch({ type: 'set-agents', agents: document.agents.map((item) => item.id === agent.id ? { ...item, name: name || null } : item) })} /><button onClick={() => dispatch({ type: 'set-agents', agents: document.agents.filter((item) => item.id !== agent.id) })}>删除歌手</button></div>)}<button onClick={() => { const id = window.prompt('歌手 ID'); if (!id) return; if (document.agents.some((agent) => agent.id === id)) return setMessage('歌手 ID 已存在'); const name = window.prompt('歌手名称') || null; dispatch({ type: 'set-agents', agents: [...document.agents, { id, name, type: null }] }); }}>添加歌手</button>
        <h2>元数据</h2>{(['title', 'artist', 'songwriter'] as const).map((key) => <label key={key}>{key}<DraftInput value={document.metadata[key]?.[0] ?? ''} label={key} onCommit={(value) => dispatch({ type: 'set-metadata', key, values: value ? [value] : [] })} /></label>)}
        {props.auxiliary}
      </aside></div>
  </div>;
}
