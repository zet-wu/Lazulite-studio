import type { useSearchConditions } from './useSearchConditions';
import { NetworkLyrics } from './NetworkLyrics';
import type { Source } from '../adapters/http/lyric-sources';
import { decodeKrcFile } from '../adapters/source-codec';
import { useRef, useState } from 'react';
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
export function LyricAcquisition({ searchConditions, document, apply, onImported, onNew, onImportName }: { searchConditions: ReturnType<typeof useSearchConditions>; document: LyricDocument; apply: (command: LyricCommand) => void; onImported: () => void; onNew?: () => void; onImportName?: (name: string) => void }) {
  const [tab, setTab] = useState('file');
  const [text, setText] = useState('');
  const [format, setFormat] = useState<Exclude<LyricFormat, 'ass'>>('txt');
  const [incoming, setIncoming] = useState<LyricDocument | null>(null);
  const [base, setBase] = useState(document);
  const [choices, setChoices] = useState<MetadataChoices>({});
  const [previewPage, setPreviewPage] = useState(0);
  const [filename, setFilename] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const request = useRef(0);
  const stage = (next: LyricDocument) => { setIncoming(next); setPreviewPage(0); setBase(document); setChoices(defaultChoices(document, next)); setMessage(''); };
  const parse = (content: string, kind: Exclude<LyricFormat, 'ass'>) => {
    try { stage(importLyricFile(content, kind)); } catch (e) { setIncoming(null); setMessage(`解析失败：${e instanceof Error ? e.message : e}`); }
  };
  const open = async (file: File) => {
    const serial = ++request.current; setFilename(file.name); setIncoming(null); setMessage('正在读取…');
    try {
      if (file.size > 4_000_000) throw new Error('歌词文件不能超过 4 MB');
      const kind = detectLyricFormat(file.name);
      if (kind === 'ass') throw new Error('ASS 目前仅支持导出');
      const content = kind === 'krc' ? await decodeKrcFile(file) : await file.text();
      if (serial === request.current) parse(content, kind);
    } catch (e) { if (serial === request.current) setMessage(`解析失败：${e instanceof Error ? e.message : e}`); }
  };
  const confirm = () => {
    if (!incoming) return;
    if (base !== document) { setBase(document); setChoices(defaultChoices(document, incoming)); setMessage('当前歌词已变化，已重新对照元数据，请检查后再次导入。'); return; }
    try { apply({ type: 'replace-document', document: { ...incoming, metadata: selectedMetadata(base, incoming, choices) } }); setIncoming(null); if (filename) onImportName?.(filename); onImported(); }
    catch (e) { setMessage(e instanceof Error ? e.message : '导入失败'); }
  };
  return <div className={styles.page}>
    <section className={styles.pane}><h2>歌词获取</h2><div className={styles.tabs} role="tablist" aria-label="歌词来源">
      {[['netease','网易云音乐'],['qqmusic','QQ 音乐'],['kugou','酷狗'],['amll','AMLL DB'],['file', '文件'], ['text', '文本']].map(([id, label]) => <button key={id} role="tab" aria-selected={tab === id} onClick={() => { ++request.current; setTab(id); setFilename(null); setIncoming(null); setMessage(''); }}>{label}</button>)}
    </div>
      {!['file','text'].includes(tab) && <NetworkLyrics searchConditions={searchConditions} key={tab} source={tab as Source} document={document} apply={apply} stage={stage} clear={() => setIncoming(null)} />}
      {tab === 'file' && <><p className={styles.hint}>选择歌词后预览，确认导入才会替换当前歌词。</p><button onClick={() => fileInput.current?.click()}>选择歌词文件</button><input ref={fileInput} hidden type="file" accept=".ttml,.xml,.txt,.lrc,.elrc,.eslrc,.qrc,.krc,.yrc,.lys" onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void open(file); }} /></>}
      {tab === 'text' && <><label>文本格式 <select value={format} onChange={e => { setFormat(e.target.value as typeof format); setIncoming(null); }}>{['txt','ttml','lrc','elrc','eslrc','qrc','krc','yrc','lys'].map(id => <option key={id}>{id}</option>)}</select></label><textarea aria-label="待导入歌词文本" value={text} onChange={e => { setText(e.target.value); setIncoming(null); }} /><button onClick={() => parse(text, format)}>预览文本</button></>}
      {onNew && <button onClick={onNew}>新建空白歌词</button>}
      {message && <p role="status">{message}</p>}
    </section>
    <section className={styles.pane}><h2>预览与导入</h2>{incoming ? <>
      <div className={styles.preview}>{incoming.lines.slice(previewPage * 100, (previewPage + 1) * 100).map(line => <p key={line.id}>{line.words.map(word => word.rubyUnits.length ? <ruby key={word.id}>{word.text}<rt>{word.rubyUnits.map(u => u.reading).join('')}</rt></ruby> : word.text)}{line.translations.map((t, i) => <small key={i}>{t.text}</small>)}{incoming.romanizationTracks.flatMap(track => track.contents.filter(c => c.lineId === line.id).map(c => <small key={c.id}>{c.kind === 'plain' ? c.text : c.units.map(u => u.text).join('')}</small>))}</p>)}</div>
      {incoming.lines.length > 100 && <div className={styles.actions}><button disabled={previewPage === 0} onClick={() => setPreviewPage(p => p - 1)}>上一页</button><span>第 {previewPage + 1} / {Math.ceil(incoming.lines.length / 100)} 页</span><button disabled={(previewPage + 1) * 100 >= incoming.lines.length} onClick={() => setPreviewPage(p => p + 1)}>下一页</button></div>}
      <p className={styles.hint}>每键选择一侧完整值列表。选择空白侧会删除该键；正文、歌手与音译轨道整体替换。</p>
      <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>键名</th><th>原值</th><th>待导入值</th></tr></thead><tbody>{Object.keys(choices).map(key => <tr key={key}><td>{key}{JSON.stringify(base.metadata[key]) === JSON.stringify(incoming.metadata[key]) && <small className={styles.hint}> · 一致</small>}</td>{(['current','incoming'] as const).map(side => <td key={side}><button aria-label={`${key} ${side === 'current' ? '原值' : '待导入值'}`} aria-pressed={choices[key] === side} onClick={() => setChoices({ ...choices, [key]: side })}>{(side === 'current' ? base : incoming).metadata[key]?.map((value, i) => <span key={i}>{value}</span>)}</button></td>)}</tr>)}</tbody></table></div>
      <div className={styles.actions}><button onClick={confirm}>确认导入并替换歌词</button><button onClick={() => { setIncoming(null); setMessage(''); }}>取消</button></div>
    </> : <p className={styles.hint}>选择文件或粘贴文本以查看歌词及元数据。</p>}</section>
  </div>;
}
