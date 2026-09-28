import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import type { LyricFormat } from '../../adapters/lyric-formats';
import styles from './semantic-editor.module.css';

type Props = {
  title: string;
  dirty: boolean;
  saving?: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onOpen?: (file: File) => void;
  onNew?: () => void;
  onSave: () => void;
  undo: () => void;
  redo: () => void;
  outlineVisible: boolean;
  inspectorVisible: boolean;
  onToggleOutline: () => void;
  onToggleInspector: () => void;
  onDraft: () => void;
  onFinal: () => void;
  onExportFormat?: (format: LyricFormat) => void;
  onMetadata: () => void;
  onSingers: () => void;
  onPublish?: () => void;
};

export function EditorMenu(props: Props) {
  const [format, setFormat] = useState<LyricFormat>('lrc');
  const [dark, setDark] = useState(() => localStorage.getItem('lazulite-editor-theme') === 'dark');
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    localStorage.setItem('lazulite-editor-theme', dark ? 'dark' : 'light');
  }, [dark]);
  return <header className={styles.header}>
    <Link to="/projects" className={styles.brand}>Lazulite Studio</Link>
    <strong>{props.title}</strong>
    <span>{props.saving ? '保存中' : props.dirty ? '未保存' : '已保存'}</span>
    <div className={styles.actions}>
      <details className={styles.settingsMenu}><summary>文件</summary><div>
        {props.onOpen && <label>导入歌词<input type="file" accept=".ttml,.xml,.txt,.lrc,.eslrc,.qrc,.yrc,.lys" hidden onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) props.onOpen?.(file);
          event.target.value = '';
        }} /></label>}
        {props.onNew && <button onClick={props.onNew}>新建</button>}
        <button onClick={props.onDraft}>下载草稿</button>
        <button onClick={props.onFinal}>最终 TTML</button>
        {props.onExportFormat && <><select aria-label="导出格式" value={format} onChange={(event) => setFormat(event.target.value as LyricFormat)}>
          <option value="txt">纯文本</option><option value="lrc">LRC</option><option value="eslrc">ESLRC</option><option value="qrc">QRC</option><option value="yrc">YRC</option><option value="lys">LYS</option><option value="ass">ASS</option>
        </select><button onClick={() => props.onExportFormat?.(format)}>导出所选格式</button></>}
        {props.onPublish && <button onClick={props.onPublish}>发布与下载</button>}
      </div></details>
      <button onClick={props.onSave} disabled={props.saving}>保存</button>
      <button onClick={props.undo} disabled={!props.canUndo}>撤销</button>
      <button onClick={props.redo} disabled={!props.canRedo}>重做</button>
      <details className={styles.settingsMenu}><summary>视图</summary><div>
        <button aria-pressed={props.outlineVisible} onClick={props.onToggleOutline}>显示大纲</button>
        <button aria-pressed={props.inspectorVisible} onClick={props.onToggleInspector}>显示属性栏</button>
        <button onClick={() => setDark((value) => !value)}>{dark ? '日间模式' : '夜间模式'}</button>
      </div></details>
      <details className={styles.settingsMenu}><summary>设置</summary><div>
        <button onClick={(event) => { event.currentTarget.closest('details')?.removeAttribute('open'); props.onMetadata(); }}>元数据编辑</button>
        <button onClick={(event) => { event.currentTarget.closest('details')?.removeAttribute('open'); props.onSingers(); }}>歌手管理</button>
      </div></details>
    </div>
  </header>;
}
