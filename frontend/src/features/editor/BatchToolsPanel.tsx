import { useState } from 'react';
import type { LyricCommand } from '../../domain/lyric-commands';
import { replaceWords, shiftLineTimes, smoothWordTimes, syncLineTimes } from '../../domain/batch-editing';
import { lineText, type LyricDocument } from '../../domain/lyric-document';
import type { EditorSelection } from './editing-actions';
import styles from './semantic-editor.module.css';

type Props = { document: LyricDocument; selection: EditorSelection | null; currentLineId: string | null; apply: (command: LyricCommand) => boolean; close: () => void };
type Operation = 'replace' | 'shift' | 'smooth' | 'sync' | 'link';

export function BatchToolsPanel({ document, selection, currentLineId, apply, close }: Props) {
  const [operation, setOperation] = useState<Operation>('replace');
  const [scope, setScope] = useState('current');
  const [from, setFrom] = useState(1);
  const [to, setTo] = useState(document.lines.length);
  const [search, setSearch] = useState('');
  const [replacement, setReplacement] = useState('');
  const [ignoreCase, setIgnoreCase] = useState(false);
  const [amountMs, setAmountMs] = useState('100');
  const [thresholdMs, setThresholdMs] = useState('15');
  const [message, setMessage] = useState('');
  const current = document.lines.find((line) => line.id === currentLineId);
  const targets = document.lines.filter((line, index) => scope === 'all' || scope === 'range' && index + 1 >= from && index + 1 <= to ||
    scope === 'selected' && selection?.kind === 'words' && line.words.some((word) => selection.ids.includes(word.id)) ||
    scope === 'selected' && selection?.kind === 'lines' && selection.ids.includes(line.backgroundOf ?? line.id) ||
    scope === 'current' && (line.id === currentLineId || line.backgroundOf === currentLineId));
  const wordIds = scope === 'selected' && selection?.kind === 'words' ? selection.ids : targets.flatMap((line) => line.words.map((word) => word.id));
  const run = () => {
    try {
      setMessage('');
      if (operation !== 'link' && !targets.length) throw new Error('所选范围没有歌词行');
      let command: LyricCommand;
      let summary = '';
      if (operation === 'replace') {
        const result = replaceWords(document, wordIds, search, replacement, ignoreCase);
        if (!result.count) throw new Error('所选范围没有匹配的词');
        command = result.command; summary = `替换 ${result.count} 处`;
      } else if (operation === 'shift') {
        const amount = Number(amountMs);
        if (!Number.isFinite(amount) || !Number.isSafeInteger(amount * 1000)) throw new Error('请输入有效的毫秒偏移量');
        command = shiftLineTimes(document, targets.map((line) => line.id), amount * 1000);
        summary = `移动 ${targets.length} 行，词、Ruby 和对齐时间一同移动`;
      } else if (operation === 'smooth') {
        const amount = Number(thresholdMs);
        if (!Number.isFinite(amount) || !Number.isSafeInteger(amount * 1000)) throw new Error('请输入有效的毫秒阈值');
        const result = smoothWordTimes(document, targets.map((line) => line.id), amount * 1000);
        if (!result.count) throw new Error('范围内没有可平滑的相邻词边界；含 Ruby 的边界会跳过');
        command = result.command; summary = `平滑 ${result.count} 处词边界`;
      } else if (operation === 'sync') {
        command = syncLineTimes(document, targets.map((line) => line.id));
        summary = `同步 ${targets.length} 行的首尾到词块包络`;
      } else {
        if (!current || current.backgroundOf) throw new Error('请先选择主唱行');
        if (current.endLink) {
          command = { type: 'unlink-line-end', lineId: current.id };
          summary = '已取消链接并恢复原结束时间';
        } else {
          const main = document.lines.filter((line) => !line.backgroundOf);
          const target = main[main.findIndex((line) => line.id === current.id) + 1];
          if (!target) throw new Error('当前行后没有主唱行');
          command = { type: 'link-line-end', lineId: current.id, targetLineId: target.id };
          summary = `结束时间链接到下一行：${lineText(target)}`;
        }
      }
      if (apply(command)) { setMessage(summary); if (operation !== 'link') close(); }
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : '批量操作失败'); }
  };
  return <div className={styles.dialogBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}><section className={styles.dialog} role="dialog" aria-modal="true" aria-label="批处理" onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); close(); } }}>
    <div className={styles.dialogHeader}><h2>批处理</h2><button aria-label="关闭批处理" onClick={close}>×</button></div>
    <div className={styles.dialogTabs}>{([['replace', '替换'], ['shift', '时间偏移'], ['smooth', '音节平滑'], ['sync', '同步行时间'], ['link', '结束时间链接']] as const).map(([value, label]) => <button key={value} className={operation === value ? styles.activeTab : ''} onClick={() => { setOperation(value); setMessage(''); }}>{label}</button>)}</div>
    {operation !== 'link' && <div className={styles.dialogControls}>
      <label>范围<select value={scope} onChange={(event) => setScope(event.target.value)}><option value="current">当前行（含背景）</option><option value="selected">选中词或行</option><option value="range">指定行范围</option><option value="all">全文</option></select></label>
      {scope === 'range' && <div className={styles.inlineFields}><label>从第 <input type="number" min="1" max={document.lines.length} value={from} onChange={(event) => setFrom(Number(event.target.value))} /> 行</label><label>到第 <input type="number" min="1" max={document.lines.length} value={to} onChange={(event) => setTo(Number(event.target.value))} /> 行</label></div>}
      {operation === 'replace' && <><label>查找<input value={search} onChange={(event) => setSearch(event.target.value)} /></label><label>替换为<input value={replacement} onChange={(event) => setReplacement(event.target.value)} /></label><label><input type="checkbox" checked={ignoreCase} onChange={(event) => setIgnoreCase(event.target.checked)} /> 忽略大小写</label></>}
      {operation === 'shift' && <label>偏移毫秒（负数为提前）<input type="number" step="1" value={amountMs} onChange={(event) => setAmountMs(event.target.value)} /></label>}
      {operation === 'smooth' && <label>相邻词间隙或重叠阈值（毫秒）<input type="number" min="0" step="1" value={thresholdMs} onChange={(event) => setThresholdMs(event.target.value)} /></label>}
    </div>}
    <p className={styles.toolHint}>{operation === 'replace' ? `目标：${wordIds.length} 词；只替换词内文本，带 Ruby/对齐的词需单独处理。` : operation === 'shift' ? `目标：${targets.length} 行；行、词、Ruby 和对齐一起平移，负值越界时整次取消。` : operation === 'smooth' ? `目标：${targets.length} 行；仅填平阈值内的普通词边界，Ruby/对齐边界保持原样。` : operation === 'sync' ? `目标：${targets.length} 行；行首尾取已定时间词的包络，未定词不变。` : current?.endLink ? `当前行链接到 ${current.endLink.targetLineId}；取消后恢复原结束时间。` : '将当前主唱行结束时间链接到下一主唱行的开始时间；词和 Ruby 时间不变。'}</p>
    <div className={styles.dialogActions}><button onClick={close}>关闭</button><button onClick={run}>{operation === 'link' && current?.endLink ? '取消链接' : '应用（一次撤销）'}</button></div>
    {message && <p role="alert">{message}</p>}
  </section></div>;
}
