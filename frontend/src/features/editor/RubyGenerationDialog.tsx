import { useMemo, useState } from 'react';
import type { LyricCommand } from '../../domain/lyric-commands';
import { lineText, type LyricDocument } from '../../domain/lyric-document';
import { proposeRuby, rubyGenerationCommand, rubySourceRows, type RubyOutput } from '../../domain/ruby-generation';
import { SettingsDialog } from './SettingsDialog';
import styles from './semantic-editor.module.css';

const time = (value: number | null) => value === null ? '未定' : `${(value / 1e6).toFixed(6).replace(/0+$/, '').replace(/\.$/, '')}s`;
const firstContents = (document: LyricDocument, trackId: string, lineIds: string[], preferred?: string) => {
  const contents = document.romanizationTracks.find((track) => track.id === trackId)?.contents.filter((content) => lineIds.includes(content.lineId)) ?? [];
  if (preferred && contents.some((content) => content.id === preferred)) return [preferred];
  const seen = new Set<string>();
  return contents.filter((content) => { if (seen.has(content.lineId)) return false; seen.add(content.lineId); return true; }).map((content) => content.id);
};

export function RubyGenerationDialog({ document, lineIds, initialTrackId, initialContentId, apply, close }: {
  document: LyricDocument; lineIds: string[]; initialTrackId?: string; initialContentId?: string;
  apply: (command: LyricCommand) => boolean; close: () => void;
}) {
  const [sourceDocument, setSourceDocument] = useState(document);
  const tracks = sourceDocument.romanizationTracks.filter((track) => track.contents.some((content) => lineIds.includes(content.lineId)));
  const [trackId, setTrackId] = useState(initialTrackId ?? tracks[0]?.id ?? '');
  const [contentIds, setContentIds] = useState(() => firstContents(document, initialTrackId ?? tracks[0]?.id ?? '', lineIds, initialContentId));
  const [output, setOutput] = useState<RubyOutput>('hiragana');
  const [assignments, setAssignments] = useState<Record<string, string | null>>({});
  const [readings, setReadings] = useState<Record<string, string>>({});
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [overwrite, setOverwrite] = useState<Set<string>>(new Set());
  const [allowExtension, setAllowExtension] = useState(false);
  const [message, setMessage] = useState('');
  const stale = document !== sourceDocument;
  const contents = tracks.find((track) => track.id === trackId)?.contents.filter((content) => lineIds.includes(content.lineId)) ?? [];
  const sourceRows = useMemo(() => contentIds.length && trackId ? rubySourceRows(sourceDocument, trackId, contentIds) : [], [sourceDocument, trackId, contentIds]);
  const rows = proposeRuby(sourceRows, output, assignments);
  const chosenWords = [...new Set(rows.filter((row) => !skipped.has(row.key)).map((row) => row.wordId).filter((id): id is string => Boolean(id)))];
  const existingWords = sourceDocument.lines.flatMap((line) => line.words.filter((word) => chosenWords.includes(word.id) && word.rubyUnits.length).map((word) => ({ line, word })));
  let preview: ReturnType<typeof rubyGenerationCommand> | null = null;
  let issue = '';
  if (!stale && rows.length) {
    try { preview = rubyGenerationCommand(sourceDocument, sourceDocument, rows, readings, skipped, overwrite, true); }
    catch (cause) { issue = cause instanceof Error ? cause.message : '提案尚未就绪'; }
  }
  const resetChoices = () => { setAssignments({}); setReadings({}); setSkipped(new Set()); setOverwrite(new Set()); setAllowExtension(false); setMessage(''); };
  const selectTrack = (id: string) => { setTrackId(id); setContentIds(firstContents(sourceDocument, id, lineIds)); resetChoices(); };
  const refresh = () => {
    const available = document.romanizationTracks.filter((track) => track.contents.some((content) => lineIds.includes(content.lineId)));
    const nextTrackId = available.some((track) => track.id === trackId) ? trackId : available[0]?.id ?? '';
    setSourceDocument(document); setTrackId(nextTrackId); setContentIds(firstContents(document, nextTrackId, lineIds)); resetChoices();
  };
  const submit = () => {
    try {
      const result = rubyGenerationCommand(document, sourceDocument, rows, readings, skipped, overwrite, allowExtension);
      if (apply(result.command)) close();
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : '生成 Ruby 失败'); }
  };
  return <SettingsDialog title="从音译生成 Ruby" close={close}>
    <div className={styles.rubyGeneration}>
      <p>范围：{lineIds.length} 条主行。原音译轨道会保留；应用后的 Ruby 与音译独立编辑。</p>
      {stale ? <p role="alert">文档已变化，旧提案不能应用。<button onClick={refresh}>重新生成提案</button></p> : <>
        <div className={styles.rubyGenerationOptions}><label>音译轨道 <select value={trackId} onChange={(event) => selectTrack(event.target.value)}>{tracks.map((track, index) => <option key={track.id} value={track.id}>轨道 {index + 1} · {track.language ?? '未指定语言'}</option>)}</select></label>
          <label>字符输出 <select value={output} onChange={(event) => { setOutput(event.target.value as RubyOutput); setReadings({}); setAllowExtension(false); }}><option value="roman">保持罗马字</option><option value="hiragana">转换为平假名</option><option value="katakana">转换为片假名</option></select></label></div>
        <fieldset><legend>选取具体音译内容</legend>{contents.map((content) => {
          const line = sourceDocument.lines.find((item) => item.id === content.lineId)!;
          return <label key={content.id}><input type="checkbox" checked={contentIds.includes(content.id)} onChange={(event) => { setContentIds((ids) => event.target.checked ? [...ids, content.id] : ids.filter((id) => id !== content.id)); resetChoices(); }} />
            {lineText(line) || '空行'} · {content.kind === 'plain' ? content.text : content.units.map((unit) => unit.text).join('')}
          </label>;
        })}</fieldset>
        <div className={styles.rubyGenerationRows}>{rows.map((row) => {
          const line = sourceDocument.lines.find((item) => item.id === row.lineId)!;
          const selected = Object.hasOwn(assignments, row.key) ? assignments[row.key] ?? '' : row.defaultWordId ?? '';
          return <div key={row.key} className={styles.rubyGenerationRow}>
            <strong>{row.sourceText || '空单元'}</strong><small>{time(row.beginUs)} – {time(row.endUs)} · {lineText(line)}</small>
            <label>目标词 <select value={selected} disabled={skipped.has(row.key)} onChange={(event) => { setAssignments((current) => ({ ...current, [row.key]: event.target.value || null })); setReadings((current) => { const next = { ...current }; delete next[row.key]; return next; }); }}>
              <option value="">待人工分配</option>{line.words.map((word) => <option key={word.id} value={word.id}>{word.text}{row.candidates.includes(word.id) ? ' · 时间重叠' : ''}</option>)}
            </select></label>
            <label>目标 Ruby <input value={readings[row.key] ?? row.reading ?? ''} disabled={skipped.has(row.key)} onChange={(event) => setReadings((current) => ({ ...current, [row.key]: event.target.value }))} /></label>
            <label><input type="checkbox" checked={skipped.has(row.key)} onChange={(event) => setSkipped((current) => { const next = new Set(current); if (event.target.checked) next.add(row.key); else next.delete(row.key); return next; })} /> 此单元不生成</label>
            {row.candidates.length > 1 && <small>跨词重叠；建议：{line.words.find((word) => word.id === row.suggestedWordId)?.text}，仍需人工指定。</small>}
            {!row.candidates.length && <small>{row.beginUs === null || row.endUs === null ? '源时间未定' : '没有正重叠词'}；需人工指定。</small>}
            {row.conversionIssue && <small role="alert">{row.conversionIssue}</small>}
          </div>;
        })}</div>
        {existingWords.length > 0 && <fieldset><legend>已有 Ruby</legend>{existingWords.map(({ word }) => <label key={word.id}><input type="checkbox" checked={overwrite.has(word.id)} onChange={(event) => setOverwrite((current) => { const next = new Set(current); if (event.target.checked) next.add(word.id); else next.delete(word.id); return next; })} />覆盖「{word.text}」现有 Ruby 及其对齐结果</label>)}</fieldset>}
        {preview?.extensions.length ? <fieldset><legend>时间包络扩展预览</legend>{preview.extensions.map((item) => <p key={`${item.kind}:${item.lineId}:${item.wordId ?? ''}`}>{item.kind === 'line' ? '行' : '词'}：{time(item.before.beginUs)}–{time(item.before.endUs)} → {time(item.after.beginUs)}–{time(item.after.endUs)}</p>)}
          <label><input type="checkbox" checked={allowExtension} onChange={(event) => setAllowExtension(event.target.checked)} /> 确认同时扩展上述词/行时间</label>
        </fieldset> : null}
        {(issue || message) && <p role="alert">{message || issue}</p>}
        <div className={styles.dialogActions}><button onClick={close}>取消</button><button disabled={!preview || Boolean(preview.extensions.length && !allowExtension)} onClick={submit}>应用（一次撤销）</button></div>
      </>}
    </div>
  </SettingsDialog>;
}
