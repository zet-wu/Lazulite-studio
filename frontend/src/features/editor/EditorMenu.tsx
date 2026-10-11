import { preferences } from '../../adapters/preferences';
import { Icon } from '../../shared/Icon';
import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import type { LyricFormat } from '../../adapters/lyric-formats';
import { KanaHighlightDialog } from './KanaHighlightDialog';
import { ShortcutDialog } from './ShortcutDialog';
import { TopMenu, type MenuState } from './TopMenu';
import styles from './semantic-editor.module.css';

type Props = MenuState & {
  title: string;
  onAmllSettings?: () => void;
  dirty: boolean;
  saving?: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onNew?: () => void;
  onSave: () => void;
  undo: () => void;
  redo: () => void;
  outlineVisible: boolean;
  inspectorVisible: boolean;
  onToggleOutline: () => void;
  onToggleInspector: () => void;
  onExportFormat?: (format: LyricFormat) => void;
};

export function EditorMenu(props: Props) {
  const [kanaOpen, setKanaOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [dark, setDark] = useState(() => preferences.getItem('lazulite-editor-theme') === 'dark');
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    preferences.setItem('lazulite-editor-theme', dark ? 'dark' : 'light');
  }, [dark]);
  return <header className={styles.header}>
    <Link to="/projects" className={styles.brand}>Lazulite Studio</Link>
    <strong>{props.title}</strong>
    <span>{props.saving ? '保存中' : props.dirty ? '未保存' : '已保存'}</span>
    <div className={styles.actions}>
      <button data-role="primary" className={styles.primaryButton} onClick={props.onSave} disabled={props.saving}>保存</button>
      <button data-role="inline" onClick={props.undo} disabled={!props.canUndo}>撤销</button>
      <button data-role="inline" onClick={props.redo} disabled={!props.canRedo}>重做</button>
      <TopMenu id="view" title="视图" className={styles.settingsMenu} activeMenuId={props.activeMenuId} onMenuChange={props.onMenuChange}>
        <button data-role="inline" aria-label="显示大纲" aria-pressed={props.outlineVisible} onClick={props.onToggleOutline}><Icon name="check"/>显示大纲</button>
        <button data-role="inline" aria-label="显示属性栏" aria-pressed={props.inspectorVisible} onClick={props.onToggleInspector}><Icon name="check"/>显示属性栏</button>
        <button data-role="inline" onClick={() => setDark((value) => !value)}>{dark ? '日间模式' : '夜间模式'}</button>
      </TopMenu>
      <TopMenu id="settings" title="设置" className={styles.settingsMenu} activeMenuId={props.activeMenuId} onMenuChange={props.onMenuChange}>
        {props.onAmllSettings && <button data-role="inline" onClick={props.onAmllSettings}>AMLL 兼容设置</button>}
        <button data-role="inline" onClick={() => setShortcutsOpen(true)}>快捷键设置</button>
        <button data-role="inline" onClick={() => setKanaOpen(true)}>音译生成假名高亮</button>
      </TopMenu>
    </div>
    {kanaOpen && <KanaHighlightDialog close={() => setKanaOpen(false)} />}
    {shortcutsOpen && <ShortcutDialog close={() => setShortcutsOpen(false)} />}
  </header>;
}
