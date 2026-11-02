import { useMessageText } from '../../shared/useMessageText';
import { message as describeMessage, errorMessage, MessageError } from '../../domain/messages';
import { i18n, formatMessage } from '../../i18n';
import { useTranslation } from 'react-i18next';
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
  useTranslation();
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
  const [message, setMessage] = useMessageText('');
  const current = document.lines.find((line) => line.id === currentLineId);
  const targets = document.lines.filter((line, index) => scope === 'all' || scope === 'range' && index + 1 >= from && index + 1 <= to ||
    scope === 'selected' && selection?.kind === 'ruby' && line.words.some(word => word.rubyUnits.some(unit => selection.ids.includes(unit.id))) ||
    scope === 'selected' && selection?.kind === 'words' && line.words.some((word) => selection.ids.includes(word.id)) ||
    scope === 'selected' && selection?.kind === 'lines' && (selection.ids.includes(line.id) || operation !== 'shift' && !!line.backgroundOf && selection.ids.includes(line.backgroundOf)) ||
    scope === 'current' && (line.id === currentLineId || operation !== 'shift' && line.backgroundOf === currentLineId));
  const wordIds = scope === 'selected' && selection?.kind === 'words' ? selection.ids : targets.flatMap((line) => line.words.map((word) => word.id));
  const rubyIds = scope === 'selected' && selection?.kind === 'ruby' ? selection.ids : document.lines.flatMap(line => line.words.filter(word => wordIds.includes(word.id)).flatMap(word => word.rubyUnits.map(unit => unit.id)));
  let preview: { command: LyricCommand; changed: number; summary: string } | undefined;
  let previewError: import('../../domain/messages').Message | null = null;
  if (operation === 'replace' || operation === 'clear-ruby') {
    try {
      if (scope === 'selected' && selection?.kind === 'ruby' && (replaceTarget === 'words' || operation === 'clear-ruby')) throw new MessageError(describeMessage('batch.selectText'));
      if (scope === 'selected' && selection?.kind !== 'words' && selection?.kind !== 'lines' && selection?.kind !== 'ruby') throw new MessageError(describeMessage('batch.select'));
      if (operation === 'clear-ruby') {
        const result = clearRuby(document, wordIds, editing);
        preview = { command: result.command, changed: result.ruby, summary: t('batch.clearSummary',{words:result.words,ruby:result.ruby,beats:result.beats}) };
      } else {
        const result = replaceText(document, replaceTarget === 'words' ? wordIds : rubyIds, replaceTarget, search, replacement, ignoreCase, editing);
        preview = { command: result.command, changed: result.changed, summary: t('batch.replaceSummary',{matches:result.count,changed:result.changed,words:result.deletedWords,ruby:result.deletedRuby,beats:result.deletedBeats}) };
      }
      if (project && preview) {
        const next = executeProjectCommand(createProjectEditorState(project), { type: 'lyrics', command: preview.command }).present;
        preview.summary += t('notice.separator')+t('batch.cuesRemoved',{count:project.karaoke.cues.length-next.karaoke.cues.length});
      }
    } catch (cause) { previewError = errorMessage(cause); }
  }
  const run = () => {
    try {
      setMessage('');
      if (operation !== 'link' && !targets.length) throw new MessageError(describeMessage('batch.noLines'));
      let command: LyricCommand;
      let summary: string | import('../../domain/messages').Message = '';
      if (operation === 'replace' || operation === 'clear-ruby') {
        if (previewError) throw new MessageError(previewError);
        if (!preview?.changed) throw new MessageError(describeMessage(operation === 'clear-ruby' ? 'batch.noRuby' : 'batch.noChanges'));
        command = preview.command; summary = preview.summary;
      } else if (operation === 'shift') {
        const amount = Number(amountMs);
        if (!Number.isFinite(amount) || !Number.isSafeInteger(Math.round(amount))) throw new MessageError(describeMessage('batch.offsetInvalid'));
        command = { type: 'shift-lines', lineIds: targets.map(line => line.id), deltaMs: Math.round(amount) };
        summary = describeMessage('batch.shiftSummary',{count:targets.length});
      } else if (operation === 'smooth') {
        const amount = Number(thresholdMs);
        if (!Number.isFinite(amount) || !Number.isSafeInteger(Math.round(amount))) throw new MessageError(describeMessage('batch.thresholdInvalid'));
        const result = smoothWordTimes(document, targets.map((line) => line.id), Math.round(amount));
        if (!result.count) throw new MessageError(describeMessage('batch.noSmooth'));
        command = result.command; summary = describeMessage('batch.smoothSummary',{count:result.count});
      } else if (operation === 'sync') {
        command = syncLineTimes(document, targets.map((line) => line.id));
        summary = describeMessage('batch.syncSummary',{count:targets.length});
      } else {
        if (!current || current.backgroundOf) throw new MessageError(describeMessage('batch.selectLead'));
        if (editing.endLinks[current.id]) {
          command = { type: 'unlink-line-end', lineId: current.id };
          summary = describeMessage('batch.unlinked');
        } else {
          const main = document.lines.filter((line) => !line.backgroundOf);
          const target = main[main.findIndex((line) => line.id === current.id) + 1];
          if (!target) throw new MessageError(describeMessage('batch.noNextLead'));
          command = { type: 'link-line-end', lineId: current.id, targetLineId: target.id };
          summary = describeMessage('batch.linkSummary',{text:lineText(target)});
        }
      }
      if (apply(command)) { setMessage(summary); if (operation !== 'link') close(); }
    } catch (cause) { setMessage(errorMessage(cause)); }
  };
  return <SettingsDialog title={t('batch.title')} close={close} actions={<><button data-role="secondary" onClick={close}>{t('common.close')}</button><button data-role="primary" onClick={run}>{operation === 'link' && (current && editing.endLinks[current.id]) ? t('batch.unlink') : t('edit.applyUndo')}</button></>}>
    <div className={styles.dialogTabs}>{([['replace', t('batch.replace')], ['clear-ruby', t('batch.clearRuby')], ['shift', t('batch.offset')], ['smooth', t('batch.smooth')], ['sync', t('batch.syncLine')], ['link', t('batch.linkEnd')]] as const).map(([value, label]) => <button data-role="secondary" key={value} aria-pressed={operation === value} className={operation === value ? styles.activeTab : ''} onClick={() => { setOperation(value); setMessage(''); }}>{label}</button>)}</div>
    {operation !== 'link' && <div className={`${styles.dialogControls} ${styles.batchControls}`}>
      <div className={styles.batchScope}><label>{t('batch.scope')}<Select value={scope} onChange={(event) => setScope(event.target.value)}><option value="current">{operation === 'shift' ? t('edit.currentLine') : t('batch.lineBackground')}</option><option value="selected">{operation === 'replace' && replaceTarget === 'ruby' ? t('batch.selectedRuby') : operation === 'shift' ? t('edit.selected') : t('batch.selectedBackground')}</option><option value="range">{t('edit.lineRange')}</option><option value="all">{t('edit.allLines')}</option></Select></label>
      {scope === 'range' && <div className={styles.batchRange}><label>{t('edit.fromLine')}<input type="number" min="1" max={document.lines.length} value={from} onChange={(event) => setFrom(Number(event.target.value))} /> {t('edit.lineUnit')}</label><label>{t('edit.toLine')}<input type="number" min="1" max={document.lines.length} value={to} onChange={(event) => setTo(Number(event.target.value))} /> {t('edit.lineUnit')}</label></div>}
      </div>
      {operation === 'replace' && <fieldset className={styles.replaceTarget}><legend>{t('batch.target')}</legend><label><input type="radio" name="replace-target" checked={replaceTarget === 'words'} onChange={() => setReplaceTarget('words')}/>{t('batch.mainText')}</label><label><input type="radio" name="replace-target" checked={replaceTarget === 'ruby'} onChange={() => setReplaceTarget('ruby')}/>{t('batch.reading')}</label></fieldset>}
      {operation === 'replace' && <div className={styles.replaceInputs}><label>{t('batch.find')}<input value={search} onChange={(event) => setSearch(event.target.value)} /></label><label>{t('batch.replaceWith')}<input value={replacement} onChange={(event) => setReplacement(event.target.value)} /></label><label><input type="checkbox" checked={ignoreCase} onChange={(event) => setIgnoreCase(event.target.checked)} /> {t('batch.ignoreCase')}</label></div>}
      {operation === 'shift' && <label>{t('batch.offsetLabel')}<input type="number" step="1" value={amountMs} onChange={(event) => setAmountMs(event.target.value)} /></label>}
      {operation === 'smooth' && <label>{t('batch.threshold')}<input type="number" min="0" step="1" value={thresholdMs} onChange={(event) => setThresholdMs(event.target.value)} /></label>}
    </div>}
    <p className={styles.toolHint}>{operation === 'clear-ruby' ? t('batch.clearHelp') : operation === 'replace' ? t('batch.emptyDeletes') : operation === 'shift' ? t('batch.targetLines',{count:targets.length}) : operation === 'smooth' ? t('batch.smoothHelp',{count:targets.length}) : operation === 'sync' ? t('batch.syncHelp',{count:targets.length}) : (current && editing.endLinks[current.id]) ? t('batch.linkedHelp',{id:editing.endLinks[current.id]}) : t('batch.linkHelp')}</p>

    {(preview || previewError) && <p role="status">{previewError ? formatMessage(previewError) : preview?.summary}{preview && !preview.changed ? operation === 'clear-ruby' ? t('notice.separator')+t('batch.noRuby') : t('notice.separator')+t('batch.noChanges') : ''}</p>}
    {message && <p role="alert">{message}</p>}
  </SettingsDialog>;
}

const t=i18n.t.bind(i18n);
