import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { studioApi, uploadMusic } from '../adapters/http/client';
import styles from './workspace.module.css';

export function MusicUpload({ projectId }: { projectId: string }) {
  const query = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const controller = useRef<AbortController | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => () => controller.current?.abort(), []);
  const upload = async (selected: File) => {
    const active = new AbortController(); controller.current = active;
    setBusy(true); setError(''); setProgress(0);
    let token: string | undefined;
    try {
      const result = await uploadMusic(selected, setProgress, active.signal); token = result.id;
      if (active.signal.aborted) { await studioApi.discardUpload(token); return; }
      setCommitting(true);
      const asset = await studioApi.attachMusic(projectId, token);
      query.setQueryData(['project', projectId], (previous: object | undefined) => ({ ...previous, asset }));
    } catch (cause) {
      setError((cause as Error).name === 'AbortError' ? '上传已取消，可重试' : (cause as Error).message);
      // Refresh media authority only; never reload the editable document.
      await query.invalidateQueries({ queryKey: ['project', projectId] });
    } finally { setBusy(false); setCommitting(false); controller.current = null; }
  };
  return <footer className={styles.musicUpload} aria-label="项目音乐"><span>未上传音乐；歌词可编辑、保存及下载。</span>
    <button data-role="secondary" disabled={busy} onClick={() => input.current?.click()}>上传音乐文件</button><input hidden ref={input} aria-label="上传音乐文件" type="file" accept="audio/*,video/mp4,.m4a" disabled={busy} onChange={event => { const next = event.target.files?.[0]; if (next) { setFile(next); void upload(next); } }}/>
    {busy && <><progress aria-label="音乐上传进度" max={1} value={progress}/><span>{committing ? '正在接入音乐…' : progress >= 1 ? '正在处理音乐…' : `上传 ${Math.round(progress * 100)}%`}</span><button data-role="secondary" disabled={committing} onClick={() => controller.current?.abort()}>取消上传</button></>}
    {error && <span role="alert">{error}{file && !busy && <button data-role="secondary" onClick={() => void upload(file)}>重试上传</button>}</span>}
  </footer>;
}
