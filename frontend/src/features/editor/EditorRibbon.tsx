import type { EditorSelection } from './editing-actions';
import styles from './semantic-editor.module.css';

type Props = {
  selection: EditorSelection | null;
  canPaste: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  copy: () => void;
  cut: () => void;
  paste: () => void;
  selectAll: () => void;
  invertSelection: () => void;
  clearSelection: () => void;
  moveUp: () => void;
  moveDown: () => void;
  openSegmentation: () => void;
  openBatchTools: () => void;
  createRubyBase: () => void;
  canCreateRubyBase: boolean;
};

export function EditorRibbon(props: Props) {
  const { selection } = props;
  return <div className={styles.ribbon} aria-label="编辑操作">
    <span>{selection ? `${selection.kind === 'words' ? '词' : selection.kind === 'lines' ? '行' : selection.kind === 'romanization-unit' ? '音译单元' : '音译内容'}已选 ${selection.ids.length}` : '当前行'}</span>
    <button onClick={props.copy} disabled={selection?.ids.length === 0}>复制</button>
    <button onClick={props.cut} disabled={selection?.ids.length === 0}>剪切</button>
    <button onClick={props.paste} disabled={!props.canPaste}>粘贴</button>
    <button onClick={props.selectAll}>全选</button>
    <button onClick={props.invertSelection}>反选</button>
    <button onClick={props.clearSelection}>清空选择</button>
    <button disabled={!props.canMoveUp} onClick={props.moveUp}>词移上行</button>
    <button disabled={!props.canMoveDown} onClick={props.moveDown}>词移下行</button>
    <button onClick={props.openSegmentation}>分词…</button>
    <button onClick={props.openBatchTools}>批处理…</button>
    <button disabled={!props.canCreateRubyBase} onClick={props.createRubyBase}>合并为 Ruby base…</button>
    <small>非输入框内 Ctrl/Cmd+C、X、V 使用词块剪贴板；Alt+↑/↓ 切词；外部纯文本按行插入。</small>
  </div>;
}
