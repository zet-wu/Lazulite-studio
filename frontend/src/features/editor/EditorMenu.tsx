import { StudioSettings } from './StudioSettings';
import { usePreference } from '../../adapters/studio-preferences';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ApplicationHeaderContext } from '../../shared/ApplicationHeaderContext';
import { createPortal } from 'react-dom';
import { IconButton } from '../../shared/Controls';
import { Icon } from '../../shared/Icon';
import { Link } from 'react-router-dom';
import { useContext, useEffect, useLayoutEffect, useState, useRef } from 'react';
import { TopMenu, type MenuState } from './TopMenu';
import styles from './semantic-editor.module.css';

type Props = MenuState & Partial<{
  title: string;
  amllSettings?: (close:()=>void) => ReactNode;
  dirty: boolean;
  editingLocked?: boolean;
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
}>;

export function EditorMenu(props: Props) {
  const {t}=useTranslation();
  const chrome = useContext(ApplicationHeaderContext);
  const setProjectHeader = chrome?.setProjectHeader;
  const projectOpen = props.title !== undefined;
  useLayoutEffect(() => {
    if (!projectOpen || !setProjectHeader) return;
    setProjectHeader(true);
    return () => setProjectHeader(false);
  }, [projectOpen, setProjectHeader]);
  const header = useRef<HTMLElement>(null);
  const [settingsOpen,setSettingsOpen]=useState(false);
  const [theme,setTheme]=usePreference('lazulite-editor-theme','light');
  const dark=theme==='dark';
  useEffect(()=>{document.documentElement.dataset.theme=theme;},[theme]);
  const content = <header ref={header} className={styles.header}>
    <Link to="/projects" className={styles.brand}>Lazulite Studio</Link>
    {props.title !== undefined && <><strong>{props.title}</strong>
    <span>{props.saving ? t('menu.saving') : props.dirty ? t('menu.unsaved') : t('menu.saved')}</span></>}
    <div className={styles.actions}>
      {props.title !== undefined && <><IconButton icon="save" label={t('menu.save')} data-role="primary" className={styles.primaryButton} onClick={props.onSave} disabled={props.saving || props.editingLocked}/>
      <IconButton icon="undo" label={t('menu.undo')} data-role="inline" onClick={props.undo} disabled={!props.canUndo}/>
      <IconButton icon="redo" label={t('menu.redo')} data-role="inline" onClick={props.redo} disabled={!props.canRedo}/>
      <TopMenu id="view" title={t('menu.view')} className={styles.settingsMenu} activeMenuId={props.activeMenuId} onMenuChange={props.onMenuChange}>
        <button data-role="inline" aria-label={t('menu.outline')} aria-pressed={props.outlineVisible} onClick={props.onToggleOutline}><Icon name="check"/>{t('menu.outline')}</button>
        <button data-role="inline" aria-label={t('menu.inspector')} aria-pressed={props.inspectorVisible} onClick={props.onToggleInspector}><Icon name="check"/>{t('menu.inspector')}</button>
        <button data-role="inline" onClick={() => { const next = !dark; setTheme(next?'dark':'light'); document.documentElement.dataset.theme = next ? 'dark' : 'light'; }}>{dark ? t('menu.light') : t('menu.dark')}</button>
      </TopMenu>
      </>}
      <button data-settings-button data-role="secondary" onClick={()=>{props.onMenuChange?.(null);setSettingsOpen(true);}}>{t('menu.settings')}</button>
    </div>
    {settingsOpen&&<StudioSettings close={()=>setSettingsOpen(false)} locked={props.editingLocked} amll={props.amllSettings?.(()=>setSettingsOpen(false))}/>}
  </header>;
  const host = chrome?.host;
  return props.title !== undefined && host ? createPortal(content, host) : content;
}
