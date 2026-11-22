import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { IconButton } from '../shared/Controls';
import { Select } from '../shared/Select';
import { SettingField } from '../shared/SettingsFields';
import fields from '../shared/settings-fields.module.css';
import { useMessageText } from '../shared/useMessageText';
import { message as describeMessage, MessageError, errorMessage } from '../domain/messages';
import type { LyricDocument } from '../domain/lyric-document';
import type { ProjectEditing } from '../domain/project-editing';
import { exportLyricFile } from '../adapters/lyric-formats';
import { uniqueOutputIssues, DocumentOutputError, type OutputIssue } from '../adapters/output-validation';
import { publishingApi } from '../adapters/http/publishing';
import { useProjectEditing } from './editor/ProjectEditingContext';
import { usePreference } from './editor/use-preference';
import { downloadBlob } from '../shared/download';
import styles from './acquisition.module.css';

type PackagingLrcKind = 'none' | 'lrc' | 'elrc';

export function MusicPackaging({
  projectId,
  document,
  saveForPackaging,
  onIssues,
}: {
  onIssues: (issues: OutputIssue[]) => void;
  projectId: string;
  document: LyricDocument;
  saveForPackaging: () => Promise<{ revision: string; document: LyricDocument; editing?: ProjectEditing } | undefined>;
}) {
  const { t } = useTranslation();
  const editing = useProjectEditing();
  const info = useQuery({
    queryKey: ['packaging', projectId],
    queryFn: () => publishingApi.info(projectId),
  });
  const [lrcKind, setLrcKind] = usePreference<PackagingLrcKind>(
    `studio:packaging:project:${projectId}`,
    'lrc',
    (v): v is PackagingLrcKind => v === 'none' || v === 'lrc' || v === 'elrc',
  );
  const [stppChoice, setStppChoice] = useState<string>('add');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useMessageText('');

  const data = info.data;
  const isMp4 = data?.container === 'mp4';

  const onIssuesRef = useRef(onIssues);
  onIssuesRef.current = onIssues;

  useEffect(() => {
    onIssuesRef.current([]);
    setError('');
  }, [lrcKind, stppChoice, document, editing, setError]);

  useEffect(() => {
    if (!data || !isMp4) return;
    if (stppChoice.startsWith('overwrite:')) {
      const id = Number(stppChoice.slice('overwrite:'.length));
      if (!data.tracks.some((item) => item.track_id === id)) setStppChoice('add');
    }
  }, [data, isMp4, stppChoice]);

  const stppAction: 'none' | 'add' | 'overwrite' = !isMp4
    ? 'none'
    : stppChoice === 'none'
      ? 'none'
      : stppChoice.startsWith('overwrite:')
        ? 'overwrite'
        : 'add';
  const targetTrackId =
    stppAction === 'overwrite' ? Number(stppChoice.slice('overwrite:'.length)) : null;

  const nothingSelected = stppAction === 'none' && lrcKind === 'none';
  const canDownload = Boolean(data?.supported) && !nothingSelected && !busy;

  const lrcTagHint =
    data?.container === 'mp4'
      ? '©lyr'
      : data?.container === 'mp3'
        ? 'ID3 USLT (eng)'
        : data?.container === 'flac'
          ? 'LYRICS'
          : undefined;

  const download = async () => {
    if (!data || !canDownload) return;
    setBusy(true);
    setError('');
    onIssues([]);
    try {
      const snapshot = document;
      const serialize = (format: 'ttml' | 'lrc' | 'elrc') => {
        try {
          return exportLyricFile(snapshot, format, editing);
        } catch (cause) {
          const issues =
            cause instanceof DocumentOutputError
              ? cause.issues
              : [
                  {
                    kind: 'line' as const,
                    lineId: '',
                    missing: [],
                    code: 'serialization' as const,
                    message: cause instanceof Error ? cause.message : t('packaging.serializeFailed'),
                  },
                ];
          throw new DocumentOutputError(
            issues.map((issue) => ({ ...issue, formats: [format.toUpperCase()], severity: 'error' })),
          );
        }
      };

      const issues: OutputIssue[] = [];
      if (stppAction !== 'none') {
        try {
          serialize('ttml');
        } catch (cause) {
          if (cause instanceof DocumentOutputError) issues.push(...cause.issues);
          else throw cause;
        }
      }
      let lrcText: string | null = null;
      if (lrcKind !== 'none') {
        try {
          lrcText = serialize(lrcKind);
        } catch (cause) {
          if (cause instanceof DocumentOutputError) issues.push(...cause.issues);
          else throw cause;
        }
      }
      if (issues.length) throw new DocumentOutputError(uniqueOutputIssues(issues));

      const saved = await saveForPackaging();
      if (!saved || saved.document !== snapshot || (saved.editing && saved.editing !== editing)) {
        throw new MessageError(describeMessage('packaging.snapshotChanged'));
      }

      const { blob, filename } = await publishingApi.download(projectId, {
        revision: saved.revision,
        asset_id: data.asset_id,
        stpp_action: stppAction,
        target_track_id: targetTrackId,
        lrc_kind: lrcKind,
        lrc_text: lrcText,
      });
      downloadBlob(blob, filename, blob.type || 'application/octet-stream');
    } catch (cause) {
      if (cause instanceof DocumentOutputError) onIssues(uniqueOutputIssues(cause.issues));
      else setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={fields.group}>
      {data && (
        <p className={styles.hint} data-packaging-source>
          {data.filename} · {data.format_label}
        </p>
      )}
      {info.isError && (
        <p role="alert">
          {t('common.readFailed')}
          <IconButton
            icon="refresh"
            label={t('packaging.retrySource')}
            data-role="secondary"
            onClick={() => void info.refetch()}
          />
        </p>
      )}
      {data && !data.supported && (
        <p role="alert">{data.error ?? t('packaging.unsupportedHelp')}</p>
      )}
      <SettingField label={t('packaging.stppField')}>
        {isMp4 ? (
          <Select
            aria-label={t('packaging.stppField')}
            value={stppChoice}
            disabled={!data?.supported || busy}
            onChange={(event) => setStppChoice(event.target.value)}
          >
            <option value="add">{t('packaging.addStpp')}</option>
            {data.tracks.map((item) => (
              <option key={item.track_id} value={`overwrite:${item.track_id}`}>
                {t('packaging.overwriteTrackOption', {
                  track: item.track_id,
                  lang: item.language,
                  name: item.name || t('packaging.unnamed'),
                })}
              </option>
            ))}
            <option value="none">{t('packaging.none')}</option>
          </Select>
        ) : (
          <Select aria-label={t('packaging.stppField')} value="unsupported" disabled>
            <option value="unsupported">{t('packaging.stppUnsupported')}</option>
          </Select>
        )}
      </SettingField>
      <SettingField label={t('packaging.lrcField')} description={lrcTagHint}>
        <Select
          aria-label={t('packaging.lrcField')}
          value={lrcKind}
          disabled={!data?.supported || busy}
          onChange={(event) => setLrcKind(event.target.value as PackagingLrcKind)}
        >
          <option value="lrc">{t('packaging.lrc')}</option>
          <option value="elrc">{t('packaging.elrcAngles')}</option>
          <option value="none">{t('packaging.none')}</option>
        </Select>
      </SettingField>
      {data?.supported && nothingSelected && (
        <p className={styles.hint} role="status">
          {t('packaging.selectAtLeastOne')}
        </p>
      )}
      <div className={styles.actions}>
        <button data-role="primary" onClick={() => void download()} disabled={!canDownload}>
          {busy ? t('packaging.downloading') : t('packaging.downloadAudio')}
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
