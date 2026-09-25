import { Link } from 'react-router-dom';
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
};

export function EditorMenu(props: Props) {
  return <header className={styles.header}>
    <Link to="/projects" className={styles.brand}>Lazulite Studio</Link>
    <strong>{props.title}</strong>
    <span>{props.saving ? '保存中' : props.dirty ? '未保存' : '已保存'}</span>
    <div className={styles.actions}>
      {props.onOpen && <label>打开 TTML<input type="file" accept=".ttml,.xml" hidden onChange={(event) => {
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
    </div>
  </header>;
}
