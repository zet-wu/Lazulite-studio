import { useState } from 'react';
import type { LyricCommand } from '../../domain/lyric-commands';
import type { LyricDocument } from '../../domain/lyric-document';
import { DraftInput } from './EditorFields';
import styles from './semantic-editor.module.css';

const preferred = ['title', 'artist', 'album', 'songwriter', 'composer', 'lyricist', 'isrc'];

export function MetadataPanel({ document, apply }: { document: LyricDocument; apply: (command: LyricCommand) => void }) {
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const keys = [...new Set([...preferred, ...Object.keys(document.metadata)])];
  return <div className={styles.metadataPanel}>
    <h2>元数据</h2>
    <label>歌词语言 <DraftInput value={document.language ?? ''} label="歌词语言" placeholder="ja / zh-Hans" onCommit={(value) => apply({ type: 'set-language', language: value || null })} /></label>
    {keys.map((key) => <label key={key}>{key}<textarea aria-label={`元数据 ${key}`} key={`${key}:${document.metadata[key]?.join('\n') ?? ''}`}
      defaultValue={document.metadata[key]?.join('\n') ?? ''} placeholder="一行一个值"
      onBlur={(event) => { const values = event.currentTarget.value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean); if (values.join('\n') !== (document.metadata[key] ?? []).join('\n')) apply({ type: 'set-metadata', key, values }); }} /></label>)}
    <label>自定义键 <input value={newKey} onChange={(event) => setNewKey(event.target.value)} placeholder="例如: ttmlAuthor" /></label>
    <label>值 <input value={newValue} onChange={(event) => setNewValue(event.target.value)} /></label>
    <button onClick={() => { if (!/^[A-Za-z][\w.-]*$/.test(newKey) || keys.includes(newKey) || !newValue.trim()) return; apply({ type: 'set-metadata', key: newKey, values: [newValue.trim()] }); setNewKey(''); setNewValue(''); }}>添加元数据</button>
  </div>;
}
