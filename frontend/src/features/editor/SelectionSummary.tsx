import { i18n } from '../../i18n';
import { useTranslation } from 'react-i18next';
import type { EditorSelection } from './editing-actions';

export function SelectionSummary({ selection, selectedCue = null }: { selection: EditorSelection | null; selectedCue?: string | null }) {
  useTranslation();
  if (selectedCue) return <span>{t('selection.cue')}</span>;
  const label = selection?.kind === 'words' ? t('selection.word')
    : selection?.kind === 'lines' ? t('selection.line')
    : selection?.kind === 'ruby' ? t('selection.ruby')
    : selection?.kind === 'romanization-unit' ? selection.attachment === 'translation' ? t('selection.translationUnit') : t('selection.romanizationUnit')
    : selection?.attachment === 'translation' ? t('selection.translation') : t('selection.romanization');
  return <span>{selection ? t('selection.summary', {kind:label,count:selection.ids.length}) : t('selection.currentLine')}</span>;
}

const t=i18n.t.bind(i18n);
