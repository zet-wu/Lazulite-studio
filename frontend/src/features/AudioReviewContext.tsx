import { SelectionProvider, useEditorSelection } from './editor/SelectionContext';
import { createContext, useContext, useState, type ReactNode } from 'react';
function useAudioState() {
  const shared = useEditorSelection()!;
  const selected = shared.selectedSegments, setSelected = shared.setSelectedSegments;
  const segmentTarget = shared.effective?.kind === 'segments';
  const [adding, setAdding] = useState(false);
  const [toolsHost, setToolsHost] = useState<HTMLDivElement | null>(null);
  const [statusHost, setStatusHost] = useState<HTMLDivElement | null>(null);
  const [timelineReady, setTimelineReady] = useState(false);
  return { selected, setSelected, segmentTarget, adding, setAdding, toolsHost, setToolsHost, statusHost, setStatusHost, timelineReady, setTimelineReady };
}
const Context = createContext<ReturnType<typeof useAudioState> | null>(null);
export const useAudioReview = () => useContext(Context)!;
export function AudioReviewProvider({ children }: { children: ReactNode }) {
  const shared = useEditorSelection();
  return shared ? <AudioStateProvider>{children}</AudioStateProvider> : <SelectionProvider><AudioStateProvider>{children}</AudioStateProvider></SelectionProvider>;
}
function AudioStateProvider({ children }: { children: ReactNode }) {
  return <Context.Provider value={useAudioState()}>{children}</Context.Provider>;
}
