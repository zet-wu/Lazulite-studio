import { useState } from 'react';
import type { LyricCommand } from '../../domain/lyric-commands';
import { lineText, type LyricDocument, type LyricWord } from '../../domain/lyric-document';
import { suggestLineRomanization, rubyReadingForWord } from '../../domain/romanization';
import { makeRubyUnits, splitReadingMora } from '../../domain/ruby-editing';
import type { EditorSelection } from './editing-actions';
import styles from './semantic-editor.module.css';

type Row = { lineId: string; lineText: string; word: LyricWord; value: string; warning: string | null };
type Props = { document: LyricDocument; selection: EditorSelection | null; currentLineId: string | null; apply: (command: LyricCommand) => boolean; close: () => void };

export function RomanizationPanel({ document, selection, currentLineId, apply, close }: Props) {
  const [scope, setScope] = useState('current');
  const [from, setFrom] = useState(1);
  const [to, setTo] = useState(document.lines.length);
  const [generateRuby, setGenerateRuby] = useState(true);
  const [overwriteRuby, setOverwriteRuby] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState('');
  const preview = () => {
    const lines = document.lines.filter((line, index) => scope === 'all' || scope === 'range' && index + 1 >= from && index + 1 <= to ||
      scope === 'selected' && (selection?.kind === 'lines' ? selection.ids.includes(line.backgroundOf ?? line.id) : selection?.kind === 'words' && line.words.some((word) => selection.ids.includes(word.id))) ||
      scope === 'current' && line.id === currentLineId);
    const next = lines.flatMap((line) => suggestLineRomanization(line).filter((item) => scope !== 'selected' || selection?.kind !== 'words' || selection.ids.includes(item.word.id))
      .map((item) => ({ lineId: line.id, lineText: lineText(line), word: item.word, value: item.word.romanization || item.value, warning: item.word.romanization ? null : item.warning })));
    setRows(next);
    setError(next.length ? '' : '所选范围没有可分配的词块');
  };
  const readingStatus = (row: Row): { reading: string | null; error: string | null } => {
    if (!row.value) return { reading: null, error: null };
    try { return { reading: rubyReadingForWord(row.word, row.value), error: null }; }
    catch (cause) { return { reading: null, error: cause instanceof Error ? cause.message : '读音转换失败' }; }
  };
  const commit = () => {
    const commands: Extract<LyricCommand, { type: 'batch' }>['commands'] = [];
    for (const row of rows) {
      if (row.value !== row.word.romanization) commands.push({ type: 'set-word-romanization', lineId: row.lineId, wordId: row.word.id, romanization: row.value });
      if (!generateRuby || !row.value || row.word.rubyUnits.length && !overwriteRuby) continue;
      const status = readingStatus(row);
      if (status.error) { setError(status.error); return; }
      if (status.reading) commands.push({ type: 'set-ruby-units', lineId: row.lineId, wordId: row.word.id,
        units: makeRubyUnits(row.word, splitReadingMora(status.reading)), overwrite: overwriteRuby });
    }
    if (!commands.length) { setError('预览中没有可应用的修改'); return; }
    if (apply({ type: 'batch', commands })) close();
  };
  return <div className={styles.dialogBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
    <section className={styles.dialog} role="dialog" aria-modal="true" aria-label="音译与 Ruby" onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); close(); } }}>
      <div className={styles.dialogHeader}><h2>音译与 Ruby</h2><button aria-label="关闭音译与 Ruby" onClick={close}>×</button></div>
      <div className={styles.dialogControls}>
        <label>应用范围<select value={scope} onChange={(event) => { setScope(event.target.value); setRows([]); }}><option value="current">当前行</option><option value="selected">选中词或行</option><option value="range">指定行范围</option><option value="all">全文</option></select></label>
        {scope === 'range' && <div className={styles.inlineFields}><label>从第 <input type="number" min="1" max={document.lines.length} value={from} onChange={(event) => { setFrom(Number(event.target.value)); setRows([]); }} /> 行</label><label>到第 <input type="number" min="1" max={document.lines.length} value={to} onChange={(event) => { setTo(Number(event.target.value)); setRows([]); }} /> 行</label></div>}
        <label><input type="checkbox" checked={generateRuby} onChange={(event) => setGenerateRuby(event.target.checked)} /> 由逐词音译生成 Ruby（按拍拆分）</label>
        <label><input type="checkbox" checked={overwriteRuby} onChange={(event) => setOverwriteRuby(event.target.checked)} /> 覆盖已有 Ruby</label>
      </div>
      <p>先按空格分配；没有明确分词时用假名词定位。可在预览中修正。已有逐词音译优先保留。</p>
      <div className={styles.dialogActions}><button onClick={preview}>生成预览</button><button disabled={!rows.length} onClick={commit}>应用（一次撤销）</button></div>
      {error && <p role="alert">{error}</p>}
      {rows.length > 0 && <div className={styles.romanizationPreview}>{rows.map((row, index) => {
        const status = readingStatus(row);
        const ruby = row.word.rubyUnits.map((unit) => unit.reading).join('');
        return <div key={row.word.id}><small>{row.lineText}</small><label>{row.word.text}<input aria-label={`逐词音译 ${row.word.text}`} value={row.value} onChange={(event) => setRows((current) => current.map((item, at) => at === index ? { ...item, value: event.target.value, warning: null } : item))} /></label>
          <span>{ruby && !overwriteRuby ? `已有 Ruby：${ruby}（保留）` : status.error ?? (status.reading ? `Ruby：${splitReadingMora(status.reading).join(' │ ')}` : '无需生成 Ruby')}</span>
          {row.warning && <em>{row.warning}</em>}</div>;
      })}</div>}
    </section>
  </div>;
}
