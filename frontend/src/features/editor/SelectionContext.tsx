import { createContext, useContext, useState, useRef, useCallback, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import type { EditorSelection, EditorClipboard } from './editing-actions';

type Selection = { kind: 'cue'; id: string; lineId: string; anchorId: string } | EditorSelection | { kind: 'segments'; ids: string[]; anchorId: string; activeId: string };
export type SelectionArea = 'canvas' | 'outline' | 'timeline';
function useSelectionState() {
  const area = useRef<SelectionArea>('canvas');
  const [focusRequest, setFocusRequest] = useState<{ selection: EditorSelection | null; area: SelectionArea; serial: number } | null>(null);
  const requestFocus = (selection: EditorSelection | null, destination = area.current) => setFocusRequest(old => ({ selection, area: destination, serial: (old?.serial ?? 0) + 1 }));
  const commands = useRef<{ openContext: (target: HTMLElement, x: number, y: number) => boolean; copy: () => EditorClipboard | null; cut: () => EditorClipboard | null; remove: (selection?: EditorSelection) => void; paste: (text?: string) => void; canCopy: boolean; canPaste: boolean; clipboardToken: () => string } | null>(null);
  const [effective, setEffective] = useState<Selection | null>(null);
  const [expanded, setExpanded] = useState<string[]>([]);
  const selection = effective?.kind === 'segments' || effective?.kind === 'cue' ? null : effective;
  const setSelection: Dispatch<SetStateAction<EditorSelection | null>> = useCallback(update => {
    setEffective(current => {
      if (typeof update === 'function' && (current?.kind === 'segments' || current?.kind === 'cue')) return current;
      const previous = (current?.kind === 'segments' || current?.kind === 'cue') ? null : current;
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
  const selectedCue = effective?.kind === 'cue' ? effective.id : null;
  const selectCue = (id: string, lineId: string) => { setEffective({kind:'cue', id, lineId, anchorId:id}); setExpanded(ids=>ids.includes(lineId)?ids:[...ids,lineId]); };
  return { area, focusRequest, requestFocus, selectedCue, selectCue, commands, effective, selection, setSelection, expanded, selectedSegments, setSelectedSegments };
}
const Context = createContext<ReturnType<typeof useSelectionState> | null>(null);
export const useEditorSelection = () => useContext(Context);
export function SelectionProvider({ children }: { children: ReactNode }) {
  return <Context.Provider value={useSelectionState()}>{children}</Context.Provider>;
}
