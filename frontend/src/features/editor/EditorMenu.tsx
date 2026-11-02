import { useTranslation } from 'react-i18next';
import { LanguageSelector } from '../LanguageSelector';
import { IconButton } from '../../shared/Controls';
import { DeviceSettings } from '../DeviceSettings';
import { SettingsDialog } from './SettingsDialog';
import { preferences } from '../../adapters/preferences';
import { Icon } from '../../shared/Icon';
import { Link } from 'react-router-dom';
import { useEffect, useState, useRef } from 'react';
import { KanaHighlightDialog } from './KanaHighlightDialog';
import { ShortcutDialog } from './ShortcutDialog';
import { TopMenu, type MenuState } from './TopMenu';
import styles from './semantic-editor.module.css';

type Props = MenuState & {
  title: string;
  onImportAudio?:()=>void;
  onDictionaryManager?: () => void;
  onAmllSettings?: () => void;
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
};

export function EditorMenu(props: Props) {
  const {t}=useTranslation();
  const header = useRef<HTMLElement>(null);
  const [devicesOpen, setDevicesOpen] = useState(false);
  const [kanaOpen, setKanaOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [dark, setDark] = useState(() => preferences.getItem('lazulite-editor-theme') === 'dark');
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    preferences.setItem('lazulite-editor-theme', dark ? 'dark' : 'light');
  }, [dark]);
  return <header ref={header} className={styles.header}>
    <Link to="/projects" className={styles.brand}>Lazulite Studio</Link>
    <strong>{props.title}</strong>
    <span>{props.saving ? t('menu.saving') : props.dirty ? t('menu.unsaved') : t('menu.saved')}</span>
    <div className={styles.actions}>
      <IconButton icon="save" label={t('menu.save')} data-role="primary" className={styles.primaryButton} onClick={props.onSave} disabled={props.saving || props.editingLocked}/>
      <IconButton icon="undo" label={t('menu.undo')} data-role="inline" onClick={props.undo} disabled={!props.canUndo}/>
      <IconButton icon="redo" label={t('menu.redo')} data-role="inline" onClick={props.redo} disabled={!props.canRedo}/>
      <TopMenu id="view" title={t('menu.view')} className={styles.settingsMenu} activeMenuId={props.activeMenuId} onMenuChange={props.onMenuChange}>
        <button data-role="inline" aria-label={t('menu.outline')} aria-pressed={props.outlineVisible} onClick={props.onToggleOutline}><Icon name="check"/>{t('menu.outline')}</button>
        <button data-role="inline" aria-label={t('menu.inspector')} aria-pressed={props.inspectorVisible} onClick={props.onToggleInspector}><Icon name="check"/>{t('menu.inspector')}</button>
        <button data-role="inline" onClick={() => setDark((value) => !value)}>{dark ? t('menu.light') : t('menu.dark')}</button>
      </TopMenu>
      <TopMenu id="settings" title={t('menu.settings')} className={`${styles.settingsMenu} ${styles.deviceSettingsMenu}`} activeMenuId={props.activeMenuId} onMenuChange={props.onMenuChange}>
        <LanguageSelector/>
        {props.onImportAudio && <button data-role="inline" disabled={props.editingLocked||props.saving} onClick={props.onImportAudio}>{t('menu.importAudio')}</button>}
        <button data-role="inline" onClick={props.onDictionaryManager}>{t('menu.dictionary')}</button>
        <button data-role="inline" onClick={() => setDevicesOpen(true)}>{t('menu.devices')}</button>
        {props.onAmllSettings && <button data-role="inline" disabled={props.editingLocked} onClick={props.onAmllSettings}>{t('menu.amll')}</button>}
        <button data-role="inline" onClick={() => setShortcutsOpen(true)}>{t('menu.shortcuts')}</button>
        <button data-role="inline" onClick={() => setKanaOpen(true)}>{t('menu.kana')}</button>
      </TopMenu>
    </div>
    {devicesOpen && <SettingsDialog title={t('menu.devices')} returnFocus={() => header.current?.querySelector<HTMLElement>('[data-top-menu="settings"] summary') ?? null} close={() => setDevicesOpen(false)}><DeviceSettings /></SettingsDialog>}
    {kanaOpen && <KanaHighlightDialog close={() => setKanaOpen(false)} />}
    {shortcutsOpen && <ShortcutDialog close={() => setShortcutsOpen(false)} />}
  </header>;
}
