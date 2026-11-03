import { useMessageText } from '../shared/useMessageText';
import { message as describeMessage, MessageError, errorMessage, isMessage, type Message } from '../domain/messages';
import { i18n, formatMessage } from '../i18n';
import { useTranslation } from 'react-i18next';
import { parsePayload } from '../adapters/http/lyric-sources';
import { LyricCandidate } from './LyricCandidate';
import styles from './acquisition.module.css';
import { useEffect, useState } from 'react';
import { requestHeaders, readApiError } from '../adapters/http/client';
import type { LyricFormat } from '../adapters/lyric-formats';
type Candidate = { id: string; label: string; format?: Exclude<LyricFormat, 'ass'>; content?: string; error?: string|Message; error_code?:string; badges?: string[] };
export function EmbeddedLyrics({ projectId, sourceAssetId, onPreview }: { projectId?: string; sourceAssetId?: string | null; onPreview: (content: string, format: Exclude<LyricFormat, 'ass'>) => void }) {
  useTranslation();
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [message, setMessage] = useMessageText('');
  useEffect(() => {
    setCandidates([]); setSelected(null);
    if (!projectId || !sourceAssetId) { setMessage(describeMessage('embedded.uploadRequired')); return; }
    const controller = new AbortController();
    setMessage(describeMessage('embedded.loading'));
    void (async () => {
      try {
        const response = await fetch(`/api/v1/projects/${encodeURIComponent(projectId)}/embedded-lyrics`, { credentials: 'include', headers: requestHeaders(), signal: controller.signal });
        if (!response.ok) throw await readApiError(response);
        const data = await response.json();
        if (data.asset_id !== sourceAssetId) throw new MessageError(describeMessage('embedded.sourceChanged'));
        if (controller.signal.aborted) return;
        setCandidates(data.candidates.map((candidate: Candidate) => {
          if (candidate.error) return {...candidate,error:describeMessage(embeddedErrors[candidate.error_code??'']??'error.unexpected',{diagnostic:typeof candidate.error==='string'?candidate.error:''})};
          try {
            if (!candidate.format || candidate.content === undefined) throw new MessageError(describeMessage('embedded.missingContent'));
            const parsed = parsePayload({empty:false,format:candidate.format,content:candidate.content,metadata:{}});
            return {...candidate,badges:parsed.badges};
          } catch (error) { return {...candidate,error:errorMessage(error)}; }
        })); setMessage(data.candidates.length ? describeMessage('embedded.help') : describeMessage('embedded.empty'));
      } catch (error) { if (!controller.signal.aborted) setMessage(errorMessage(error)); }
    })();
    return () => controller.abort();
  }, [projectId, sourceAssetId]);
  return <section aria-label={t('packaging.embedded')}><p role="status">{message}</p><div className={styles.results} aria-label={t('embedded.candidate')}>{candidates.map(candidate =>
    <LyricCandidate key={candidate.id} title={candidate.label} badges={candidate.badges ?? []} status={isMessage(candidate.error)?formatMessage(candidate.error):candidate.error}
      failed={!!candidate.error} disabled={!!candidate.error} selected={selected===candidate.id}
      onSelect={() => { setSelected(candidate.id); onPreview(candidate.content!, candidate.format!); }}/>
  )}</div></section>;
}

const t=i18n.t.bind(i18n);

const embeddedErrors:Record<string,string>={invalid_format:'embedded.invalidFormat',unsupported_sylt:'embedded.unsupportedSylt',stpp_read_failed:'embedded.stppFailed'};
