import type { EditorSelection } from './editing-actions';

export function SelectionSummary({ selection, selectedCue = null }: { selection: EditorSelection | null; selectedCue?: string | null }) {
  if (selectedCue) return <span>导唱已选 1</span>;
  const label = selection?.kind === 'words' ? '词'
    : selection?.kind === 'lines' ? '行'
    : selection?.kind === 'ruby' ? '注音'
    : selection?.kind === 'romanization-unit' ? selection.attachment === 'translation' ? '翻译单元' : '音译单元'
    : selection?.attachment === 'translation' ? '翻译内容' : '音译内容';
  return <span>{selection ? `${label}已选 ${selection.ids.length}` : '当前行'}</span>;
}
