import { createContext, useContext, useState, useRef, useCallback, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import type { EditorSelection, EditorClipboard } from './editing-actions';

type Selection = EditorSelection | { kind: 'segments'; ids: string[]; anchorId: string; activeId: string };
function useSelectionState() {
  const commands = useRef<{ copy: () => EditorClipboard | null; cut: () => EditorClipboard | null; remove: () => void; paste: (text?: string) => void; canCopy: boolean; canPaste: boolean; clipboardToken: () => string } | null>(null);
  const [effective, setEffective] = useState<Selection | null>(null);
  const [expanded, setExpanded] = useState<string[]>([]);
  const selection = effective?.kind === 'segments' ? null : effective;
  const setSelection: Dispatch<SetStateAction<EditorSelection | null>> = useCallback(update => {
    setEffective(current => {
      if (typeof update === 'function' && current?.kind === 'segments') return current;
      const previous = current?.kind === 'segments' ? null : current;
      const next = typeof update === 'function' ? update(previous) : update;
      return next;
    });
    if (typeof update !== 'function' && update) {
      if (update.kind === 'lines') setExpanded(update.ids);
      else setExpanded(ids => ids.includes(update.lineId) ? ids : [...ids, update.lineId]);
    }
  }, []);
  const selectedSegments = effective?.kind === 'segments' ? effective.ids : [];
  const setSelectedSegments: Dispatch<SetStateAction<string[]>> = useCallback(update => setEffective(current => {
    if (typeof update === 'function' && current?.kind !== 'segments') return current;
    const previous = current?.kind === 'segments' ? current : null;
    const ids = typeof update === 'function' ? update(previous?.ids ?? []) : update;
    if (previous && ids.length === previous.ids.length && ids.every((id, index) => id === previous.ids[index])) return current;
    return { kind: 'segments', ids, anchorId: previous?.anchorId && ids.includes(previous.anchorId) ? previous.anchorId : ids[0] ?? '', activeId: ids.at(-1) ?? '' };
  }), []);
  return { commands, effective, selection, setSelection, expanded, selectedSegments, setSelectedSegments };
}
const Context = createContext<ReturnType<typeof useSelectionState> | null>(null);
export const useEditorSelection = () => useContext(Context);
export function SelectionProvider({ children }: { children: ReactNode }) {
  return <Context.Provider value={useSelectionState()}>{children}</Context.Provider>;
}
