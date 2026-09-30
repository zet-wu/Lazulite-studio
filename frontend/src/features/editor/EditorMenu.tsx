import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import type { LyricFormat } from '../../adapters/lyric-formats';
import { TopMenu, type MenuState } from './TopMenu';
import styles from './semantic-editor.module.css';

type Props = MenuState & {
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
  onPublish?: () => void;
};

export function EditorMenu(props: Props) {
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
      <button className={styles.primaryButton} onClick={props.onSave} disabled={props.saving}>保存</button>
      <button onClick={props.undo} disabled={!props.canUndo}>撤销</button>
      <button onClick={props.redo} disabled={!props.canRedo}>重做</button>
      <TopMenu id="view" title="视图" className={styles.settingsMenu} activeMenuId={props.activeMenuId} onMenuChange={props.onMenuChange}>
        <button aria-label="显示大纲" aria-pressed={props.outlineVisible} onClick={props.onToggleOutline}>显示大纲</button>
        <button aria-label="显示属性栏" aria-pressed={props.inspectorVisible} onClick={props.onToggleInspector}>显示属性栏</button>
        <button onClick={() => setDark((value) => !value)}>{dark ? '日间模式' : '夜间模式'}</button>
      </TopMenu>
    </div>
  </header>;
}
