import { i18n } from '../../i18n';
import { useTranslation } from 'react-i18next';
import type { EditorSelection } from './editing-actions';
import { SelectionSummary } from './SelectionSummary';
import { TopMenu, type MenuState } from './TopMenu';
import styles from './semantic-editor.module.css';

type Props = MenuState & {
  selection: EditorSelection | null;
  canPaste: boolean;
  canCopy: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  copy: () => void;
  cut: () => void;
  remove: () => void;
  paste: () => void;
  selectAll: () => void;
  invertSelection: () => void;
  clearSelection: () => void;
  moveUp: () => void;
  moveDown: () => void;
  openSegmentation: () => void;
  openBatchTools: () => void;
  canGenerateJapaneseRuby: boolean;
  openJapaneseRuby: () => void;
  openDictionaryRuby: () => void;
  openShapeConversion: () => void;
  canGenerateRuby: boolean;
  openRubyGeneration: () => void;
  canGenerateRomanization: boolean;
  openRomanizationGeneration: () => void;
  openTranslationTracks: () => void;
  openTracks: () => void;
  openMetadata: () => void;
  singersDisabled?: boolean;
  openSingers: () => void;
};

export function EditorRibbon(props: Props) {
  useTranslation();
  const { selection } = props;
  return <div className={styles.ribbon} aria-label={t('editor.actions')}>
    <SelectionSummary selection={selection} />
    <TopMenu id="clipboard" title={t('editor.clipboard')} className={styles.ribbonMenu} activeMenuId={props.activeMenuId} onMenuChange={props.onMenuChange}>
      <button data-role="inline" onClick={props.copy} disabled={!selection?.ids.length || !props.canCopy}>{t('common.copy')}</button>
      <button data-role="inline" onClick={props.cut} disabled={!selection?.ids.length || !props.canCopy}>{t('common.cut')}</button>
      <button data-role="inline" onClick={props.remove} disabled={!selection?.ids.length}>删除</button>
      <button data-role="inline" onClick={props.paste} disabled={!props.canPaste}>{t('common.paste')}</button>
      <button data-role="inline" onClick={props.selectAll}>{t('common.selectAll')}</button>
      <button data-role="inline" onClick={props.invertSelection}>{t('common.invertSelection')}</button>
      <button data-role="inline" onClick={props.clearSelection}>{t('common.clearSelection')}</button>
    </TopMenu>
    <TopMenu id="tools" title={t('editor.tools')} className={styles.ribbonMenu} activeMenuId={props.activeMenuId} onMenuChange={props.onMenuChange}>
      <button data-role="inline" disabled={!props.canMoveUp} onClick={props.moveUp}>{t('editor.wordsUp')}</button>
      <button data-role="inline" disabled={!props.canMoveDown} onClick={props.moveDown}>{t('editor.wordsDown')}</button>
      <button data-role="inline" onClick={props.openSegmentation}>{t('editor.segment')}</button>
      <button data-role="inline" onClick={props.openBatchTools}>{t('editor.batch')}</button>
      <button data-role="inline" disabled={!props.canGenerateRomanization} onClick={props.openRomanizationGeneration}>{t('editor.romanize')}</button>
      <button data-role="inline" disabled={!props.canGenerateJapaneseRuby} onClick={props.openJapaneseRuby}>{t('editor.japaneseRuby')}</button>
      <button data-role="inline" disabled={!props.canGenerateJapaneseRuby} onClick={props.openDictionaryRuby}>{t('editor.dictionaryRuby')}</button>
      <button data-role="inline" disabled={!props.canGenerateJapaneseRuby} onClick={props.openShapeConversion}>{t('editor.shape')}</button>
      <button data-role="inline" disabled={!props.canGenerateRuby} onClick={props.openRubyGeneration}>{t('editor.rubyFromRomanization')}</button>
    </TopMenu>
    <TopMenu id="lyrics-settings" title={t('editor.lyricsSettings')} className={styles.ribbonMenu} activeMenuId={props.activeMenuId} onMenuChange={props.onMenuChange}>
      <button data-role="inline" onClick={props.openMetadata}>{t('editor.metadata')}</button>
      <button data-role="inline" disabled={props.singersDisabled} onClick={props.openSingers}>{t('editor.singers')}</button>
      <button data-role="inline" onClick={props.openTranslationTracks}>{t('editor.translationTracks')}</button>
      <button data-role="inline" onClick={props.openTracks}>{t('editor.romanizationTracks')}</button>
    </TopMenu>
  </div>;
}

const t=i18n.t.bind(i18n);
