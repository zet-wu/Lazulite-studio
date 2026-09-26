import { Link } from 'react-router-dom';
import { useState } from 'react';
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
  simpleLayout: boolean;
  onToggleLayout: () => void;
  onDraft: () => void;
  onFinal: () => void;
  onExportFormat?: (format: LyricFormat) => void;
};

export function EditorMenu(props: Props) {
  const [format, setFormat] = useState<LyricFormat>('lrc');
  return <header className={styles.header}>
    <Link to="/projects" className={styles.brand}>Lazulite Studio</Link>
    <strong>{props.title}</strong>
    <span>{props.saving ? '保存中' : props.dirty ? '未保存' : '已保存'}</span>
    <div className={styles.actions}>
      {props.onOpen && <label>导入歌词<input type="file" accept=".ttml,.xml,.txt,.lrc,.eslrc,.qrc,.yrc,.lys" hidden onChange={(event) => {
        const file = event.target.files?.[0];
        if (file) props.onOpen?.(file);
        event.target.value = '';
      }} /></label>}
      {props.onNew && <button onClick={props.onNew}>新建</button>}
      <button onClick={props.onSave} disabled={props.saving}>保存</button>
      <button onClick={props.undo} disabled={!props.canUndo}>撤销</button>
      <button onClick={props.redo} disabled={!props.canRedo}>重做</button>
      <button onClick={props.onToggleLayout}>{props.simpleLayout ? '高级布局' : '简单布局'}</button>
      <button onClick={props.onDraft}>下载草稿</button>
      <button onClick={props.onFinal}>最终 TTML</button>
      {props.onExportFormat && <><select aria-label="导出格式" value={format} onChange={(event) => setFormat(event.target.value as LyricFormat)}>
        <option value="txt">纯文本</option><option value="lrc">LRC</option><option value="eslrc">ESLRC</option><option value="qrc">QRC</option><option value="yrc">YRC</option><option value="lys">LYS</option><option value="ass">ASS</option>
      </select><button onClick={() => props.onExportFormat?.(format)}>导出所选格式</button></>}
    </div>
  </header>;
}
