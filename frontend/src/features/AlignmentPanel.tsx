import { preferences } from '../adapters/preferences';
import { alignmentDefaults, resolveDefaultModel } from '../adapters/studio-preferences';
import { Select } from '../shared/Select';
import { capabilityReason, taskError } from './task-messages';
import { message as describeMessage, messageList, MessageError, errorMessage, type Message } from '../domain/messages';
import { useMessageText } from '../shared/useMessageText';
import { i18n } from '../i18n';
import { useTranslation } from 'react-i18next';
import { useProjectJobs } from './useProjectJobs';
import { IconButton } from '../shared/Controls';
import { useNotice, type Notice } from '../shared/MessageBar';
import { useTrayEntry } from './FloatingTray';
import { useEffect, useId, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createPortal } from 'react-dom';
import { alignmentApi, defaultAlignmentOptions, type AlignmentSummary, type AlignmentCatalog } from '../adapters/http/alignment';
import { jobsApi } from '../adapters/http/jobs';
import { studioApi } from '../adapters/http/client';
import { mergeAlignment } from '../domain/alignment';
import type { ProjectDocument } from '../domain/project-document';
import { SettingField, SettingToggle } from '../shared/SettingsFields';
import fields from '../shared/settings-fields.module.css';
import styles from './alignment.module.css';
import { SettingsDialog } from './editor/SettingsDialog';
import { useAudioReview } from './AudioReviewContext';

export type AlignmentControl = {
  locked: boolean;
  lock: () => { source: ProjectDocument; release: () => void; apply: (project: ProjectDocument) => void };
  save: () => Promise<{ revision: string } | undefined>;
};

type AlignmentRunOptions = ReturnType<typeof defaultAlignmentOptions> & {
  model_preview?: string;
  gap_threshold_ms: number;
};

type PendingRun = {
  id: string;
  revision: string;
  options: AlignmentRunOptions;
  source: string;
};

const ACTIVE_STATUSES = new Set(['queued', 'running', 'cancel_requested']);

export function AlignmentPanel({
  pid,
  assetId,
  durationMs,
  project,
  dirty = false,
  control,
  visible,
  finishDraft,
}: {
  pid: string;
  assetId?: string;
  durationMs: number | null;
  project: ProjectDocument;
  dirty?: boolean;
  control: AlignmentControl;
  visible: boolean;
  finishDraft: () => boolean;
}) {
  useTranslation();
  const ui = useAudioReview();
  const queryClient = useQueryClient();
  const [catalog, setCatalog] = useState<AlignmentCatalog | null>(null);
  const [model, setModel] = useState('');
  const [defaultMissing, setDefaultMissing] = useState(false);
  const [previewRevision, setPreviewRevision] = useState('');
  const [previewError, setPreviewError] = useState('');
  const previewSerial = useRef(0);
  const [previewAttempt, setPreviewAttempt] = useState(0);

  const caps = useQuery({ queryKey: ['capabilities'], queryFn: () => studioApi.getCapabilities() });
  const jobs = useProjectJobs(pid, visible);
  const [dialog, setDialog] = useState(false);
  const [options, setOptions] = useState(defaultAlignmentOptions);
  const [summary, setSummary] = useState<AlignmentSummary | null>(null);
  const [gapDraft, setGapDraft] = useState('500');
  const [gapError, setGapError] = useMessageText('');
  const gapErrorId = useId();
  const [message, setMessage] = useNotice();
  const [connection, setConnection] = useNotice();
  const recent = useRef<Notice | null>(null);
  const launchButton = useRef<HTMLButtonElement>(null);
  const resultMessage = (text: string | Message, role: Notice['role'] = 'alert', timeout?: number, taskId?: string) => {
    recent.current = setMessage(text, role, timeout, taskId);
    if (recent.current) recent.current.origin = launchButton.current;
  };
  const [cpuFailure, setCpuFailure] = useState<{
    id: string;
    source: string;
    revision: string;
    options: AlignmentRunOptions;
  } | null>(null);
  const [launching, setLaunching] = useState(false);
  const [opening, setOpening] = useState(false);
  const [pendingRun, setPendingRun] = useState<PendingRun | null>(null);
  const handledRuns = useRef(new Set<string>());
  const mounted = useRef(true);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const projectRef = useRef(project);
  projectRef.current = project;
  const durationRef = useRef(durationMs);
  durationRef.current = durationMs;
  const assetIdRef = useRef(assetId);
  assetIdRef.current = assetId;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, [pid]);

  const capability = caps.data?.items.find((c) => c.id === 'job.alignment');
  const activeJob = jobs.data?.items.find((j) => ['vocal', 'alignment'].includes(j.kind) && ACTIVE_STATUSES.has(j.status));
  const active = Boolean(activeJob);
  const runningAlignment = activeJob?.kind === 'alignment' || launching;
  const reason = !assetId
    ? t('alignment.uploadRequired')
    : durationMs === null
      ? t('alignment.durationUnknown')
      : !project.lyrics.lines.some((l) => !project.editing.skippedAlignmentLineIds.includes(l.id))
        ? t('alignment.noLines')
        : !capability?.enabled
          ? capability
            ? capabilityReason(capability)
            : t('alignment.checkingModels')
          : active
            ? t('alignment.busy')
            : null;

  useEffect(() => {
    if (!pendingRun) {
      setConnection(null);
      return;
    }
    if (jobs.isError) {
      setConnection(describeMessage('task.reconnecting', { diagnostic: (jobs.error as Error)?.message ?? '' }));
    } else {
      setConnection(null);
    }
  }, [pendingRun, jobs.isError, jobs.error, setConnection]);

  useEffect(() => {
    if (!pendingRun || !jobs.data?.items) return;
    const job = jobs.data.items.find((item) => item.id === pendingRun.id);
    if (!job || ACTIVE_STATUSES.has(job.status) || handledRuns.current.has(job.id)) return;
    handledRuns.current.add(job.id);

    if (job.status === 'succeeded') {
      void (async () => {
        try {
          const result = await alignmentApi.result(job.id);
          const current = await studioApi.getDocumentEnvelope(pid);
          if (!mounted.current) return;
          if (
            dirtyRef.current ||
            current.revision !== pendingRun.revision ||
            result.binding.revision !== pendingRun.revision ||
            result.binding.project_id !== pid ||
            result.binding.asset_id !== assetIdRef.current
          ) {
            throw new MessageError(describeMessage('alignment.sourceChanged'));
          }
          if (durationRef.current === null) {
            throw new MessageError(describeMessage('alignment.resultDurationUnknown'));
          }
          const lock = control.lock();
          try {
            const merged = mergeAlignment(
              lock.source,
              result,
              durationRef.current,
              pendingRun.options.clear_unmatched,
              pendingRun.options.merge_short_gaps ? pendingRun.options.gap_threshold_ms : null,
            );
            lock.apply(merged.project);
            void jobsApi.acknowledge(job.id, 'applied').catch(() => undefined);
            resultMessage(
              messageList([
                ...(result.normalization && (result.normalization.clipped || result.normalization.dropped)
                  ? [
                      describeMessage('task.normalized', {
                        clipped: result.normalization.clipped,
                        dropped: result.normalization.dropped,
                      }),
                    ]
                  : []),
                describeMessage(merged.project === lock.source ? 'alignment.noChanges' : 'alignment.updated'),
                ...(merged.mergedGaps ? [describeMessage('alignment.mergedGaps', { count: merged.mergedGaps })] : []),
                ...(merged.cleared.length ? [describeMessage('alignment.cleared', { count: merged.cleared.length })] : []),
                ...(merged.retained.length ? [describeMessage('alignment.retained', { count: merged.retained.length })] : []),
              ]),
              'status',
              merged.retained.length || merged.cleared.length ? 8000 : 4000,
            );
          } finally {
            lock.release();
          }
        } catch (error) {
          if (mounted.current) resultMessage(errorMessage(error));
        } finally {
          if (mounted.current) {
            setPendingRun((current) => (current?.id === job.id ? null : current));
            setConnection(null);
          }
        }
      })();
      return;
    }

    if (job.status === 'failed' && job.error?.cpu_retry) {
      setCpuFailure({
        id: job.id,
        source: pendingRun.source,
        revision: pendingRun.revision,
        options: pendingRun.options,
      });
    }
    resultMessage(
      job.error
        ? taskError(job.error)
        : job.status === 'cancelled'
          ? describeMessage('alignment.cancelled')
          : describeMessage('task.interruptedRetry'),
      job.status === 'cancelled' ? 'status' : 'alert',
      job.status === 'cancelled' ? 4000 : undefined,
      job.id,
    );
    setPendingRun((current) => (current?.id === job.id ? null : current));
    setConnection(null);
  }, [pendingRun, jobs.data?.items, pid, control, setConnection]);

  const open = async () => {
    if (!finishDraft()) return;
    setOpening(true);
    setMessage('');
    const defaults = alignmentDefaults();
    const defaultModel = preferences.getItem('studio:alignment-model');
    setOptions(defaults);
    setGapDraft(String(defaults.gap_threshold_ms));
    setGapError('');
    try {
      const saved = await control.save();
      if (!saved) throw new MessageError(describeMessage('alignment.saveRequired'));
      const data = await alignmentApi.models();
      if (mounted.current) {
        setCatalog(data);
        const selected = resolveDefaultModel(data.items, defaultModel);
        setModel(selected.id);
        setDefaultMissing(selected.missing);
        setSummary(null);
        setPreviewRevision(saved.revision);
        setDialog(true);
      }
    } catch (e) {
      setMessage(errorMessage(e));
    } finally {
      if (mounted.current) setOpening(false);
    }
  };

  useEffect(() => {
    const serial = ++previewSerial.current;
    setSummary(null);
    setPreviewError('');
    if (!dialog || !catalog?.items.some((item) => item.id === model && item.status === 'ready')) return;
    let alive = true;
    void alignmentApi
      .preview(pid, previewRevision, model, options)
      .then((data) => {
        if (alive && serial === previewSerial.current) {
          setSummary(data);
          if (!data.hint_count) setOptions((current) => ({ ...current, use_hints: false }));
        }
      })
      .catch((e) => {
        if (alive && serial === previewSerial.current) setPreviewError((e as Error).message);
      });
    return () => {
      alive = false;
    };
  }, [
    dialog,
    pid,
    previewRevision,
    model,
    options.latin_normalize,
    options.strip_tone_digits,
    options.convert_particles,
    catalog,
    previewAttempt,
  ]);

  const start = async (retryCpu = false) => {
    if (launching || active) return;
    const threshold = options.merge_short_gaps ? Number(gapDraft) : 500;
    if (options.merge_short_gaps && (!gapDraft.trim() || !Number.isSafeInteger(threshold) || threshold <= 0)) {
      setGapError(describeMessage('alignment.gapRange'));
      return;
    }
    const failed = retryCpu ? cpuFailure : null;
    if (retryCpu && (!failed || failed.source !== JSON.stringify(projectRef.current))) {
      setMessage(describeMessage('alignment.intentChanged'));
      return;
    }
    if (!failed && !summary?.emitting_count) return;
    const selected: AlignmentRunOptions = failed?.options ?? {
      ...options,
      model_preview: summary!.model_preview,
      gap_threshold_ms: threshold,
    };
    const capturedSource = JSON.stringify(projectRef.current);
    setDialog(false);
    setLaunching(true);
    setMessage('');
    setConnection('');
    recent.current = null;
    try {
      const saved = await control.save();
      if (!saved) throw new MessageError(describeMessage('alignment.revisionUnknown'));
      if (failed && saved.revision !== failed.revision) {
        throw new MessageError(describeMessage('alignment.revisionChanged'));
      }
      setCpuFailure(null);
      const key = crypto.randomUUID();
      let job;
      try {
        job = failed
          ? await jobsApi.retryCpu(failed.id, saved.revision, key)
          : await alignmentApi.start(pid, saved.revision, selected, key);
      } catch (e) {
        if (e instanceof TypeError) {
          job = failed
            ? await jobsApi.retryCpu(failed.id, saved.revision, key)
            : await alignmentApi.start(pid, saved.revision, selected, key);
        } else {
          throw e;
        }
      }
      setPendingRun({
        id: job.id,
        revision: saved.revision,
        options: selected,
        source: capturedSource,
      });
      await queryClient.invalidateQueries({ queryKey: ['vocal-jobs', pid] });
    } catch (e) {
      if (mounted.current) resultMessage(errorMessage(e));
    } finally {
      if (mounted.current) setLaunching(false);
    }
  };

  useTrayEntry(
    'alignment-message',
    message
      ? {
          kind: 'notice',
          version: `${message.taskId ?? ''}:${message.role}:${Boolean(cpuFailure?.id === message.taskId)}:${active}:${control.locked}:${Boolean(reason)}`,
          notice: message,
          actions:
            message.taskId && cpuFailure?.id === message.taskId ? (
              <button
                data-role="secondary"
                disabled={runningAlignment || control.locked || active}
                onClick={() => void start(true)}
              >
                {t('task.retryCpu')}
              </button>
            ) : message.taskId && message.role === 'alert' ? (
              <IconButton
                icon="refresh"
                label={t('alignment.retry')}
                data-role="secondary"
                disabled={runningAlignment || control.locked || !!reason}
                onClick={() => void open()}
              />
            ) : undefined,
        }
      : null,
  );
  useTrayEntry('alignment-connection', connection ? { kind: 'notice', notice: connection } : null);

  const button = (
    <span className={styles.entry}>
      <button
        ref={launchButton}
        data-role="primary"
        disabled={!!reason || opening || runningAlignment || control.locked}
        onClick={() => void open()}
      >
        {runningAlignment ? t('task.aligning') : t('settings.alignment')}
      </button>
      {reason && !runningAlignment && <small>{reason}</small>}
      {!runningAlignment && recent.current && (
        <button
          data-role="inline"
          onClick={() => {
            const notice = recent.current!;
            setMessage(notice.text, notice.role, notice.timeout, notice.taskId);
          }}
        >
          {t('alignment.recent')}
        </button>
      )}
    </span>
  );

  return (
    <>
      {visible && ui.alignmentHost && createPortal(button, ui.alignmentHost)}
      {dialog && (
        <SettingsDialog
          title={t('settings.alignment')}
          close={() => setDialog(false)}
          actions={
            <>
              <button data-role="secondary" data-initial-focus onClick={() => setDialog(false)}>
                {t('common.cancel')}
              </button>
              <button data-role="primary" disabled={!summary?.emitting_count} onClick={() => void start()}>
                {t('alignment.start')}
              </button>
            </>
          }
        >
          {defaultMissing && !model && <p role="alert">{t('settings.defaultModelMissing')}</p>}
          <SettingField label={t('alignment.model')}>
            <Select
              value={model}
              onChange={(e) => {
                if (e.target.value !== model) {
                  setSummary(null);
                  setModel(e.target.value);
                }
              }}
            >
              <option value="">{t('alignment.selectModel')}</option>
              {model && !catalog?.items.some((item) => item.id === model && item.status === 'ready') && (
                <option value={model} disabled>
                  {t('alignment.modelMissing')}
                </option>
              )}
              {catalog?.items
                .filter((item) => item.status === 'ready')
                .map((item) => (
                  <option key={item.id} value={item.id!}>
                    {item.name} · {item.type}
                  </option>
                ))}
            </Select>
          </SettingField>

          {catalog?.error && <p role="alert">{catalog.error}</p>}
          {previewError && (
            <p role="alert">
              {previewError}
              <IconButton
                icon="refresh"
                data-role="secondary"
                label={t('common.retry')}
                onClick={() => setPreviewAttempt((value) => value + 1)}
              />
            </p>
          )}
          <fieldset className={fields.group}>
            <legend>{t('alignment.preprocessing')}</legend>
            <SettingToggle
              label={t('alignment.latinNormalize')}
              checked={options.latin_normalize}
              onChange={(value) => {
                setSummary(null);
                setOptions({ ...options, latin_normalize: value });
              }}
            />
            <SettingToggle
              label={t('alignment.stripTones')}
              checked={options.strip_tone_digits}
              onChange={(value) => {
                setSummary(null);
                setOptions({ ...options, strip_tone_digits: value });
              }}
            />
          </fieldset>
          <fieldset className={fields.group}>
            <legend>{t('alignment.postprocessing')}</legend>
            <SettingToggle
              label={t('alignment.clearUnmatched')}
              description={t('alignment.clearHelp')}
              checked={options.clear_unmatched}
              onChange={(value) => setOptions({ ...options, clear_unmatched: value })}
            />
            <SettingToggle
              label={t('alignment.smartExtend')}
              description={t('alignment.smartExtendHelp')}
              checked={options.smart_extend}
              onChange={(value) => setOptions({ ...options, smart_extend: value })}
            />
            <SettingToggle
              label={t('alignment.mergeGapsLabel')}
              checked={options.merge_short_gaps}
              onChange={(value) => {
                setOptions({ ...options, merge_short_gaps: value });
                setGapError('');
              }}
            />
            <SettingField label={t('alignment.gapThreshold')}>
              <input
                type="number"
                min="1"
                step="1"
                aria-label={t('alignment.gapThreshold')}
                aria-invalid={!!gapError}
                aria-describedby={gapError ? gapErrorId : undefined}
                disabled={!options.merge_short_gaps}
                value={gapDraft}
                onChange={(e) => {
                  setGapDraft(e.target.value);
                  setGapError('');
                }}
              />{' '}
              ms
            </SettingField>
            {gapError && (
              <p id={gapErrorId} className={fields.error} role="alert">
                {gapError}
              </p>
            )}
          </fieldset>
          <fieldset className={fields.group}>
            <legend>{t('alignment.experimental')}</legend>
            <SettingToggle
              label={t('alignment.useStarts')}
              description={
                summary ? (summary.hint_count ? t('alignment.startsHelp') : t('alignment.noStarts')) : t('alignment.startsHelp')
              }
              checked={options.use_hints}
              disabled={!summary?.hint_count}
              onChange={(value) => setOptions({ ...options, use_hints: value })}
            />
            {(
              [
                ['line_blank', t('alignment.blankCost'), t('alignment.blankHelp')],
                ['rest_blank', t('alignment.restBlankCost'), t('alignment.restBlankHelp')],
                ['rest_token', t('alignment.restTokenCost'), t('alignment.restTokenHelp')],
              ] as const
            ).map(([key, label, description]) => (
              <SettingToggle
                key={key}
                label={label}
                description={description}
                checked={options[key]}
                onChange={(value) => setOptions({ ...options, [key]: value })}
              />
            ))}
          </fieldset>
          {!!summary?.unknown_count && <p>{t('alignment.unknownReadings', { count: summary.unknown_count })}</p>}
          {summary && !summary.emitting_count && <p>{t('alignment.noReadings')}</p>}
          <p role="status">
            {summary
              ? t('alignment.scope', { included: summary.line_count, skipped: summary.skipped_count })
              : previewError
                ? ''
                : catalog?.items.some((item) => item.id === model && item.status === 'ready')
                  ? t('alignment.preparingInput')
                  : t('alignment.selectModel')}
          </p>
        </SettingsDialog>
      )}
    </>
  );
}

const t = i18n.t.bind(i18n);
