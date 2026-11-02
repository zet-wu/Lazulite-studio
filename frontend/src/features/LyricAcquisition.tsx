import { useMessageText } from '../shared/useMessageText';
import { message as describeMessage, MessageError, errorMessage, isMessage, type Message } from '../domain/messages';
import { i18n, formatMessage } from '../i18n';
import { useTranslation } from 'react-i18next';
import { EmbeddedLyrics } from './EmbeddedLyrics';
import { createProjectEditing } from '../domain/project-editing';
import { translationsForLine } from '../domain/lyric-document';
import { translationText } from '../domain/lyric-document';
import { Select } from '../shared/Select';
import { IconButton } from '../shared/Controls';
import type { useSearchConditions } from './useSearchConditions';
import { AcquisitionStore } from '../acquisition-store';
import { NetworkLyrics, checkLabels } from './NetworkLyrics';
import type { Source } from '../adapters/http/lyric-sources';
import { decodeKrcFile } from '../adapters/source-codec';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { detectLyricFormat, importLyricFile, type LyricFormat } from '../adapters/lyric-formats';
import { type LyricDocument } from '../domain/lyric-document';
import type { LyricCommand } from '../domain/lyric-commands';
import styles from './acquisition.module.css';

export type MetadataChoices = Record<string, 'current' | 'incoming'>;
export function defaultChoices(current: LyricDocument, incoming: LyricDocument): MetadataChoices {
  return Object.fromEntries([...new Set([...Object.keys(current.metadata), ...Object.keys(incoming.metadata)])].map(key => [key, current.metadata[key]?.length ? 'current' : 'incoming']));
}
export function selectedMetadata(current: LyricDocument, incoming: LyricDocument, choices: MetadataChoices) {
  return Object.fromEntries(Object.entries(choices).flatMap(([key, side]) => {
    const values = (side === 'current' ? current : incoming).metadata[key];
    return values?.length ? [[key, [...values]]] : [];
  }));
}
export function LyricAcquisition({ store, searchConditions, document, apply, onImported, onNew, onImportName, projectId, sourceAssetId }: { projectId?: string; sourceAssetId?: string | null; store: AcquisitionStore; searchConditions: ReturnType<typeof useSearchConditions>; document: LyricDocument; apply: (command: LyricCommand) => void; onImported: () => void; onNew?: () => void; onImportName?: (name: string) => void }) {
  useTranslation();
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const tab = snapshot.tab;
  const network = tab !== 'file' && tab !== 'text' && tab !== 'embedded';
  const selected = network && snapshot.sources[tab].selected ? snapshot.sources[tab].records[snapshot.sources[tab].selected!] : null;
  const networkPreview = network ? store.preview(tab) : null;
  const [dismissed, setDismissed] = useState(false);
  const [text, setText] = useState('');
  const [format, setFormat] = useState<Exclude<LyricFormat, 'ass'>>('txt');
  const [incoming, setIncoming] = useState<LyricDocument | null>(null);
  const [base, setBase] = useState(document);
  const [choices, setChoices] = useState<MetadataChoices>({});
  const [previewPage, setPreviewPage] = useState(0);
  const [filename, setFilename] = useState<string | null>(null);
  const [message, setMessage] = useMessageText('');
  const fileInput = useRef<HTMLInputElement>(null);
  const request = useRef(0);
  const stage = (next: LyricDocument) => { setIncoming(next); setPreviewPage(0); setBase(document); setChoices(defaultChoices(document, next)); setMessage(''); };
  useEffect(() => {
    if (networkPreview) stage(networkPreview); else if (network) setIncoming(null);
  }, [networkPreview, tab]);
  useEffect(() => { if (tab === 'embedded') setIncoming(null); }, [sourceAssetId]);
  useEffect(() => setDismissed(false), [tab, selected?.candidate.id, selected?.error]);
  const parse = (content: string, kind: Exclude<LyricFormat, 'ass'>) => {
    try { stage(importLyricFile(content, kind)); } catch (e) { setIncoming(null); setMessage(describeMessage('acquire.parseFailed',{diagnostic:e instanceof Error?e.message:String(e)})); }
  };
  const open = async (file: File) => {
    const serial = ++request.current; setFilename(file.name); setIncoming(null); setMessage(describeMessage('common.reading'));
    try {
      if (file.size > 4_000_000) throw new MessageError(describeMessage('acquire.fileLimit'));
      const kind = detectLyricFormat(file.name);
      if (kind === 'ass') throw new MessageError(describeMessage('acquire.assExportOnly'));
      const content = kind === 'krc' ? await decodeKrcFile(file) : await file.text();
      if (serial === request.current) parse(content, kind);
    } catch (e) { if (serial === request.current) setMessage(describeMessage('acquire.parseFailed',{diagnostic:e instanceof Error?e.message:String(e)})); }
  };
  const confirm = () => {
    if (!incoming) return;
    if (base !== document) { setBase(document); setChoices(defaultChoices(document, incoming)); setMessage(describeMessage('acquire.changed')); return; }
    try { apply({ type: 'replace-document', editing: createProjectEditing(), document: { ...incoming, metadata: selectedMetadata(base, incoming, choices) } }); setIncoming(null); store.cancelAll(); if (filename) onImportName?.(filename); onImported(); }
    catch (e) { setMessage(errorMessage(e)); }
  };
  return <div className={styles.page}>
    <section className={styles.pane}><h2>{t('editor.acquire')}</h2><div className={styles.tabs} role="tablist" aria-label={t('acquire.source')}>
      {[['netease',t('source.netease')],['qqmusic',t('source.qq')],['kugou',t('source.kugou')],['amll','AMLL DB'],['embedded', t('source.embedded')], ['file', t('source.file')], ['text', t('source.text')]].map(([id, label]) => <button data-role="secondary" key={id} role="tab" aria-selected={tab === id} onClick={() => { ++request.current; store.setTab(id as typeof tab); setFilename(null); setIncoming(null); setMessage(''); }}>{label}</button>)}
    </div>
      {network && <NetworkLyrics store={store} searchConditions={searchConditions} key={tab} source={tab as Source} document={document} apply={apply} />}
      {tab === 'embedded' && <EmbeddedLyrics projectId={projectId} sourceAssetId={sourceAssetId} onPreview={parse} />}
      {tab === 'file' && <><button data-role="secondary" onClick={() => fileInput.current?.click()}>{t('acquire.chooseFile')}</button><input ref={fileInput} hidden type="file" accept=".ttml,.xml,.txt,.lrc,.elrc,.eslrc,.qrc,.krc,.yrc,.lys" onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void open(file); }} /></>}
      {tab === 'text' && <><label>{t('acquire.textFormat')}<Select value={format} onChange={e => { setFormat(e.target.value as typeof format); setIncoming(null); }}>{['txt','ttml','lrc','elrc','eslrc','qrc','krc','yrc','lys'].map(id => <option key={id}>{id}</option>)}</Select></label><textarea aria-label={t('acquire.textInput')} value={text} onChange={e => { setText(e.target.value); setIncoming(null); }} /><button data-role="secondary" onClick={() => parse(text, format)}>{t('acquire.previewText')}</button></>}
      {onNew && <button data-role="secondary" onClick={onNew}>{t('acquire.emptyLyrics')}</button>}
      {message && <p role="status">{message}</p>}
    </section>
    <section className={styles.pane}><h2>{t('acquire.previewImport')}</h2>
      {selected && selected.error && !dismissed && <div className={styles.previewError} role="status"><span>{t(checkLabels[selected.status])}：{(isMessage(selected.error)?formatMessage(selected.error):selected.error).slice(0,160)}</span><IconButton icon="close" data-role="secondary" label={t('acquire.dismissCandidate')} onClick={()=>setDismissed(true)}/></div>}
      {selected && ['pending','fetching','parsing'].includes(selected.status) && <p role="status">{t(checkLabels[selected.status])}…</p>}
      {incoming ? <>
      <div className={styles.preview}>{incoming.lines.slice(previewPage * 100, (previewPage + 1) * 100).map(line => <p key={line.id}>{line.words.map(word => word.rubyUnits.length ? <ruby key={word.id}>{word.text}<rt>{word.rubyUnits.map(u => u.reading).join('')}</rt></ruby> : word.text)}{translationsForLine(incoming, line.id).map((t, i) => <small key={i}>{translationText(t)}</small>)}{incoming.romanizationTracks.flatMap(track => track.contents.filter(c => c.lineId === line.id).map(c => <small key={c.id}>{c.kind === 'plain' ? c.text : c.units.map(u => u.text).join('')}</small>))}</p>)}</div>
      {incoming.lines.length > 100 && <div className={styles.actions}><IconButton icon="back" label={t('common.previousPage')} data-role="secondary" disabled={previewPage === 0} onClick={() => setPreviewPage(p => p - 1)}/><span>{t('acquire.page',{page:previewPage+1,pages:Math.ceil(incoming.lines.length/100)})}</span><IconButton icon="chevron" label={t('common.nextPage')} data-role="secondary" disabled={(previewPage + 1) * 100 >= incoming.lines.length} onClick={() => setPreviewPage(p => p + 1)}/></div>}
      <p className={styles.hint}>{t('acquire.metadataHelp')}</p>
      <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>{t('acquire.key')}</th><th>{t('acquire.originalValue')}</th><th>{t('acquire.incomingValue')}</th></tr></thead><tbody>{Object.keys(choices).map(key => <tr key={key}><td>{key}{JSON.stringify(base.metadata[key]) === JSON.stringify(incoming.metadata[key]) && <small className={styles.hint}> {t('acquire.identical')}</small>}</td>{(['current','incoming'] as const).map(side => <td key={side}><button data-role="secondary" aria-label={`${key} ${side === 'current' ? t('acquire.originalValue') : t('acquire.incomingValue')}`} aria-pressed={choices[key] === side} onClick={() => setChoices({ ...choices, [key]: side })}>{(side === 'current' ? base : incoming).metadata[key]?.map((value, i) => <span key={i}>{value}</span>)}</button></td>)}</tr>)}</tbody></table></div>
      <div className={styles.actions}><button data-role="primary" onClick={confirm}>{t('acquire.confirm')}</button><button data-role="secondary" onClick={() => { setIncoming(null); setMessage(''); }}>{t('common.cancel')}</button></div>
    </> : null}</section>
  </div>;
}

const t=i18n.t.bind(i18n);
