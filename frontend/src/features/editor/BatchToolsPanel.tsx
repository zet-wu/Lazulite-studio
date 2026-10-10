import { useProjectEditing } from './ProjectEditingContext';
import type { ProjectDocument } from '../../domain/project-document';
import { executeProjectCommand, createProjectEditorState } from '../../domain/project-document';
import { Select } from '../../shared/Select';
import { SettingsDialog } from './SettingsDialog';
import { useState } from 'react';
import type { LyricCommand } from '../../domain/lyric-commands';
import { replaceText, clearRuby, smoothWordTimes, syncLineTimes } from '../../domain/batch-editing';
import { lineText, type LyricDocument } from '../../domain/lyric-document';
import type { EditorSelection } from './editing-actions';
import styles from './semantic-editor.module.css';

type Props = { project?: ProjectDocument; document: LyricDocument; selection: EditorSelection | null; currentLineId: string | null; apply: (command: LyricCommand) => boolean; close: () => void };
type Operation = 'clear-ruby' | 'replace' | 'shift' | 'smooth' | 'sync' | 'link';

export function BatchToolsPanel({ project, document, selection, currentLineId, apply, close }: Props) {
  const editing = useProjectEditing();
  const [operation, setOperation] = useState<Operation>('replace');
  const [replaceTarget, setReplaceTarget] = useState<'words' | 'ruby'>('words');
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
    scope === 'selected' && selection?.kind === 'ruby' && line.words.some(word => word.rubyUnits.some(unit => selection.ids.includes(unit.id))) ||
    scope === 'selected' && selection?.kind === 'words' && line.words.some((word) => selection.ids.includes(word.id)) ||
    scope === 'selected' && selection?.kind === 'lines' && (selection.ids.includes(line.id) || operation !== 'shift' && !!line.backgroundOf && selection.ids.includes(line.backgroundOf)) ||
    scope === 'current' && (line.id === currentLineId || operation !== 'shift' && line.backgroundOf === currentLineId));
  const wordIds = scope === 'selected' && selection?.kind === 'words' ? selection.ids : targets.flatMap((line) => line.words.map((word) => word.id));
  const rubyIds = scope === 'selected' && selection?.kind === 'ruby' ? selection.ids : document.lines.flatMap(line => line.words.filter(word => wordIds.includes(word.id)).flatMap(word => word.rubyUnits.map(unit => unit.id)));
  let preview: { command: LyricCommand; changed: number; summary: string } | undefined;
  let previewError = '';
  if (operation === 'replace' || operation === 'clear-ruby') {
    try {
      if (scope === 'selected' && selection?.kind === 'ruby' && (replaceTarget === 'words' || operation === 'clear-ruby')) throw new Error('请选择词／行，或切换替换对象为注音');
      if (scope === 'selected' && selection?.kind !== 'words' && selection?.kind !== 'lines' && selection?.kind !== 'ruby') throw new Error('请选择词／行或注音');
      if (operation === 'clear-ruby') {
        const result = clearRuby(document, wordIds, editing);
        preview = { command: result.command, changed: result.ruby, summary: `涉及 ${result.words} 词，清除 ${result.ruby} 个 Ruby、${result.beats} 个空拍` };
      } else {
        const result = replaceText(document, replaceTarget === 'words' ? wordIds : rubyIds, replaceTarget, search, replacement, ignoreCase, editing);
        preview = { command: result.command, changed: result.changed, summary: `匹配 ${result.count} 处，实际修改 ${result.changed} 个对象；删除 ${result.deletedWords} 词、${result.deletedRuby} 个 Ruby、${result.deletedBeats} 个空拍` };
      }
      if (project && preview) {
        const next = executeProjectCommand(createProjectEditorState(project), { type: 'lyrics', command: preview.command }).present;
        preview.summary += `、${project.karaoke.cues.length - next.karaoke.cues.length} 个导唱`;
      }
    } catch (cause) { previewError = (cause as Error).message; }
  }
  const run = () => {
    try {
      setMessage('');
      if (operation !== 'link' && !targets.length) throw new Error('所选范围没有歌词行');
      let command: LyricCommand;
      let summary = '';
      if (operation === 'replace' || operation === 'clear-ruby') {
        if (previewError) throw new Error(previewError);
        if (!preview?.changed) throw new Error(operation === 'clear-ruby' ? '无可清除的注音' : '没有实际变化');
        command = preview.command; summary = preview.summary;
      } else if (operation === 'shift') {
        const amount = Number(amountMs);
        if (!Number.isFinite(amount) || !Number.isSafeInteger(Math.round(amount))) throw new Error('请输入有效的毫秒偏移量');
        command = { type: 'shift-lines', lineIds: targets.map(line => line.id), deltaMs: Math.round(amount) };
        summary = `移动 ${targets.length} 行，词、注音、附属时间和导唱一同移动`;
      } else if (operation === 'smooth') {
        const amount = Number(thresholdMs);
        if (!Number.isFinite(amount) || !Number.isSafeInteger(Math.round(amount))) throw new Error('请输入有效的毫秒阈值');
        const result = smoothWordTimes(document, targets.map((line) => line.id), Math.round(amount));
        if (!result.count) throw new Error('范围内没有可平滑的 CJK 相邻词边界；含 注音 的边界会跳过');
        command = result.command; summary = `平滑 ${result.count} 处词边界`;
      } else if (operation === 'sync') {
        command = syncLineTimes(document, targets.map((line) => line.id));
        summary = `同步 ${targets.length} 行的首尾到词块包络`;
      } else {
        if (!current || current.backgroundOf) throw new Error('请先选择主唱行');
        if (editing.endLinks[current.id]) {
          command = { type: 'unlink-line-end', lineId: current.id };
          summary = '已取消链接并保留当前结束时间';
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
  return <SettingsDialog title="批处理" close={close} actions={<><button data-role="secondary" onClick={close}>关闭</button><button data-role="primary" onClick={run}>{operation === 'link' && (current && editing.endLinks[current.id]) ? '取消链接' : '应用（一次撤销）'}</button></>}>
    <div className={styles.dialogTabs}>{([['replace', '替换'], ['clear-ruby', '清除注音'], ['shift', '时间偏移'], ['smooth', '音节平滑'], ['sync', '同步行时间'], ['link', '结束时间链接']] as const).map(([value, label]) => <button data-role="secondary" key={value} aria-pressed={operation === value} className={operation === value ? styles.activeTab : ''} onClick={() => { setOperation(value); setMessage(''); }}>{label}</button>)}</div>
    {operation !== 'link' && <div className={styles.dialogControls}>
      <label>范围<Select value={scope} onChange={(event) => setScope(event.target.value)}><option value="current">{operation === 'shift' ? '当前行' : '当前行（含背景）'}</option><option value="selected">{operation === 'replace' && replaceTarget === 'ruby' ? '选中词／行／Ruby（主行含背景）' : operation === 'shift' ? '选中词或行' : '选中词或行（主行含背景）'}</option><option value="range">指定行范围</option><option value="all">全文</option></Select></label>
      {scope === 'range' && <div className={styles.inlineFields}><label>从第 <input type="number" min="1" max={document.lines.length} value={from} onChange={(event) => setFrom(Number(event.target.value))} /> 行</label><label>到第 <input type="number" min="1" max={document.lines.length} value={to} onChange={(event) => setTo(Number(event.target.value))} /> 行</label></div>}
      {operation === 'replace' && <><fieldset><legend>替换对象</legend><label><input type="radio" name="replace-target" checked={replaceTarget === 'words'} onChange={() => setReplaceTarget('words')}/>正文</label><label><input type="radio" name="replace-target" checked={replaceTarget === 'ruby'} onChange={() => setReplaceTarget('ruby')}/>注音</label></fieldset><label>查找<input value={search} onChange={(event) => setSearch(event.target.value)} /></label><label>替换为<input value={replacement} onChange={(event) => setReplacement(event.target.value)} /></label><label><input type="checkbox" checked={ignoreCase} onChange={(event) => setIgnoreCase(event.target.checked)} /> 忽略大小写</label></>}
      {operation === 'shift' && <label>偏移毫秒（负数为提前）<input type="number" step="1" value={amountMs} onChange={(event) => setAmountMs(event.target.value)} /></label>}
      {operation === 'smooth' && <label>相邻词间隙或重叠阈值（毫秒）<input type="number" min="0" step="1" value={thresholdMs} onChange={(event) => setThresholdMs(event.target.value)} /></label>}
    </div>}
    <p className={styles.toolHint}>{operation === 'clear-ruby' ? '清除范围内正文词的全部 Ruby 及其空拍、失效导唱；正文及独立音译／翻译保持。' : operation === 'replace' ? replaceTarget === 'words' ? '仅替换正文，注音与附属内容保持；空结果删除对应对象。' : '仅替换各 Ruby 内读音，不重新分配时间；空结果删除对应 Ruby。' : operation === 'shift' ? `目标：${targets.length} 行；行、词、注音、附属时间和导唱一起平移，负值越界时整次取消。` : operation === 'smooth' ? `目标：${targets.length} 行；仅填平阈值内的 CJK 相邻词边界，注音/对齐边界保持原样。` : operation === 'sync' ? `目标：${targets.length} 行；行首尾取已定时间词的包络，未定词不变；改变已链接行的结束时间会取消链接。` : (current && editing.endLinks[current.id]) ? `当前行链接到 ${editing.endLinks[current.id]}；取消后保留当前结束时间。` : '将当前主唱行结束时间链接到下一主唱行的开始时间；词和 注音 时间不变。'}</p>

    {(preview || previewError) && <p role="status">{previewError || preview?.summary}{preview && !preview.changed ? operation === 'clear-ruby' ? '；无可清除的注音' : '；没有实际变化' : ''}</p>}
    {message && <p role="alert">{message}</p>}
  </SettingsDialog>;
}
