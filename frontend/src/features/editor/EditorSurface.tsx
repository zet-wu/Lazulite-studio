import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { LyricCommand } from '../../domain/lyric-commands';
import { createLine, createWord, lineText, type LyricDocument, type LyricLine, type LyricWord, type TimeUs } from '../../domain/lyric-document';
import { utf16ToCodePoint } from '../../domain/text-boundaries';
import styles from './semantic-editor.module.css';

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

function DraftInput({ value, label, onCommit, onFocus, onSplit }: { value: string; label: string; onCommit: (value: string) => void; onFocus?: () => void; onSplit?: (at: number) => void }) {
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLInputElement>(null);
  const composing = useRef(false);
  useEffect(() => setDraft(value), [value]);
  return <input ref={ref} aria-label={label} value={draft} onChange={(event) => setDraft(event.target.value)} onFocus={onFocus}
    onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
    onBlur={() => { if (draft !== value) onCommit(draft); }}
    onKeyDown={(event) => {
      if (composing.current) return;
      if (event.key === 'Enter') ref.current?.blur();
      if (event.key === 'Escape') { setDraft(value); ref.current?.blur(); }
      if (event.key === 'F8' && onSplit) { event.preventDefault(); onSplit(ref.current?.selectionStart ?? 0); }
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
  const [selection, setSelection] = useState<{ lineId: string; wordId: string | null; rubyId: string | null } | null>(null);
  const [message, setMessage] = useState('');
  const selectedLine = document.lines.find((line) => line.id === (selection?.lineId ?? props.selectedLineId)) ?? document.lines[0];
  const select = (lineId: string, wordId: string | null = null, rubyId: string | null = null) => { setSelection({ lineId, wordId, rubyId }); props.onSelectLine?.(lineId); };
  const dispatch = (command: LyricCommand) => {
    try { apply(command); setMessage(''); }
    catch (error) { setMessage(error instanceof Error ? error.message : '编辑失败'); }
  };
  const sublyric = (line: LyricLine, kind: 'translations' | 'romanizations', index: number, text: string) => {
    const items = line[kind].map((item, i) => i === index ? { ...item, text } : item);
    dispatch({ type: 'set-sublyrics', lineId: line.id, kind, items });
  };
  const wordView = (line: LyricLine, word: LyricWord) => <div className={styles.word} key={word.id} data-word-id={word.id}>
    <div className={styles.wordMain}>
      <DraftInput value={word.text} label={`词 ${word.text}`} onFocus={() => select(line.id, word.id)}
        onCommit={(text) => dispatch({ type: 'edit-word', lineId: line.id, wordId: word.id, text })}
        onSplit={(at) => dispatch({ type: 'split-word', lineId: line.id, wordId: word.id, at: utf16ToCodePoint(word.text, at) })} />
      <button aria-label={`拆分词 ${word.text}`} title="按光标位置拆分；输入中可按 F8" onClick={() => {
        const at = Math.floor(Array.from(word.text).length / 2);
        dispatch({ type: 'split-word', lineId: line.id, wordId: word.id, at });
      }}>拆</button>
      <button aria-label={`删除词 ${word.text}`} onClick={() => dispatch({ type: 'delete-word', lineId: line.id, wordId: word.id })}>×</button>
    </div>
    <TimePair begin={word.beginUs} end={word.endUs} label={`词 ${word.text}`} onCommit={(beginUs, endUs) => dispatch({ type: 'set-word-time', lineId: line.id, wordId: word.id, beginUs, endUs })} />
    <div className={styles.rubies}>{word.rubyUnits.map((unit) => <div key={unit.id} className={styles.ruby}>
      <DraftInput value={unit.reading} label={`读音 ${word.text}`} onFocus={() => select(line.id, word.id, unit.id)}
        onCommit={(reading) => dispatch({ type: 'edit-ruby', lineId: line.id, wordId: word.id, rubyId: unit.id, reading })} />
      <button aria-label={`删除读音 ${unit.reading}`} onClick={() => dispatch({ type: 'delete-ruby', lineId: line.id, wordId: word.id, rubyId: unit.id })}>×</button>
      <TimePair begin={unit.beginUs} end={unit.endUs} label={`读音 ${unit.reading}`} onCommit={(beginUs, endUs) => dispatch({ type: 'set-ruby-time', lineId: line.id, wordId: word.id, rubyId: unit.id, beginUs, endUs })} />
    </div>)}<button onClick={() => { const reading = window.prompt('输入读音'); if (reading) dispatch({ type: 'add-ruby', lineId: line.id, wordId: word.id, reading }); }}>加读音</button></div>
  </div>;
  return <div className={styles.page}>
    <header className={styles.header}><Link to="/projects" className={styles.brand}>Lazulite Studio</Link><strong>{props.title}</strong><span>{props.saving ? '保存中' : props.dirty ? '未保存' : '已保存'}</span>
      <div className={styles.actions}>{props.onOpen && <label>打开 TTML<input type="file" accept=".ttml,.xml" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) props.onOpen?.(file); event.target.value = ''; }} /></label>}{props.onNew && <button onClick={props.onNew}>新建</button>}<button onClick={props.onSave} disabled={props.saving}>保存</button><button onClick={props.undo} disabled={!props.canUndo}>撤销</button><button onClick={props.redo} disabled={!props.canRedo}>重做</button><button onClick={props.onDraft}>下载草稿</button><button onClick={props.onFinal}>最终 TTML</button></div>
    </header>
    {(message || props.error) && <p role="alert" className={styles.error}>{message || props.error}</p>}
    <div className={styles.layout}><aside className={styles.outline}><h2>大纲</h2>{document.lines.map((line, index) => <button key={line.id} className={selectedLine?.id === line.id ? styles.selected : ''} onClick={() => select(line.id)}>{index + 1} {line.backgroundOf ? '↳ ' : ''}{lineText(line) || '空行'}</button>)}</aside>
      <main className={styles.canvas}><div className={styles.canvasHeader}><h1>歌词编辑</h1><button onClick={() => dispatch({ type: 'insert-line', afterLineId: document.lines.at(-1)?.id ?? null })}>新增歌词行</button></div>
        {document.lines.map((line) => <section className={`${styles.line} ${selectedLine?.id === line.id ? styles.selectedLine : ''}`} key={line.id} data-line-id={line.id} onClick={() => { if (selection?.lineId !== line.id) select(line.id); }}>
          <div className={styles.lineHeader}><span>{line.backgroundOf ? '背景' : '主唱'} · {line.id}</span><TimePair begin={line.beginUs} end={line.endUs} label={`行 ${line.id}`} onCommit={(beginUs, endUs) => dispatch({ type: 'set-line-time', lineId: line.id, beginUs, endUs })} />
            <button onClick={() => dispatch({ type: 'insert-line', afterLineId: line.id })}>后插行</button><button onClick={() => dispatch({ type: 'delete-line', lineId: line.id })}>删行</button></div>
          <div className={styles.words}>{line.words.map((word) => wordView(line, word))}<button onClick={() => dispatch({ type: 'insert-word', lineId: line.id, afterWordId: line.words.at(-1)?.id ?? null, word: createWord('新词') })}>加词</button></div>
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
