import type { EditorSelection } from './editing-actions';
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
  canGenerateRuby: boolean;
  openRubyGeneration: () => void;
  canGenerateRomanization: boolean;
  openRomanizationGeneration: () => void;
  openTracks: () => void;
  openMetadata: () => void;
  openSingers: () => void;
};

export function EditorRibbon(props: Props) {
  const { selection } = props;
  return <div className={styles.ribbon} aria-label="编辑操作">
    <span>{selection ? `${selection.kind === 'words' ? '词' : selection.kind === 'lines' ? '行' : selection.kind === 'ruby' ? '注音' : selection.kind === 'romanization-unit' ? '音译单元' : '音译内容'}已选 ${selection.ids.length}` : '当前行'}</span>
    <TopMenu id="clipboard" title="选择与剪贴" className={styles.ribbonMenu} activeMenuId={props.activeMenuId} onMenuChange={props.onMenuChange}>
      <button data-role="inline" onClick={props.copy} disabled={!selection?.ids.length || !props.canCopy}>复制</button>
      <button data-role="inline" onClick={props.cut} disabled={!selection?.ids.length || !props.canCopy}>剪切</button>
      <button data-role="inline" onClick={props.remove} disabled={!selection?.ids.length}>删除</button>
      <button data-role="inline" onClick={props.paste} disabled={!props.canPaste}>粘贴</button>
      <button data-role="inline" onClick={props.selectAll}>全选</button>
      <button data-role="inline" onClick={props.invertSelection}>反选</button>
      <button data-role="inline" onClick={props.clearSelection}>清空选择</button>
    </TopMenu>
    <TopMenu id="tools" title="编辑工具" className={styles.ribbonMenu} activeMenuId={props.activeMenuId} onMenuChange={props.onMenuChange}>
      <button data-role="inline" disabled={!props.canMoveUp} onClick={props.moveUp}>词移上行</button>
      <button data-role="inline" disabled={!props.canMoveDown} onClick={props.moveDown}>词移下行</button>
      <button data-role="inline" onClick={props.openSegmentation}>分词…</button>
      <button data-role="inline" onClick={props.openBatchTools}>批处理…</button>
      <button data-role="inline" disabled={!props.canGenerateRomanization} onClick={props.openRomanizationGeneration}>生成日文罗马字音译…</button>
      <button data-role="inline" disabled={!props.canGenerateJapaneseRuby} onClick={props.openJapaneseRuby}>生成日文注音…</button>
      <button data-role="inline" disabled={!props.canGenerateRuby} onClick={props.openRubyGeneration}>从音译生成 注音…</button>
    </TopMenu>
    <TopMenu id="lyrics-settings" title="歌词设置" className={styles.ribbonMenu} activeMenuId={props.activeMenuId} onMenuChange={props.onMenuChange}>
      <button data-role="inline" onClick={props.openMetadata}>元数据编辑</button>
      <button data-role="inline" onClick={props.openSingers}>歌手管理</button>
      <button data-role="inline" onClick={props.openTracks}>管理音译轨道…</button>
    </TopMenu>
  </div>;
}
