import { SelectionProvider, useEditorSelection } from './editor/SelectionContext';
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
function useAudioState() {
  const shared = useEditorSelection()!;
  const selected = shared.selectedSegments, setSelected = shared.setSelectedSegments;
  const segmentTarget = shared.effective?.kind === 'segments';
  const [adding, setAdding] = useState(false);
  const [uploadHost, setUploadHost] = useState<HTMLSpanElement | null>(null);
  const [analysisHost, setAnalysisHost] = useState<HTMLDivElement | null>(null);
  const [toolsHost, setToolsHost] = useState<HTMLDivElement | null>(null);
  const [alignmentHost, setAlignmentHost] = useState<HTMLDivElement | null>(null);
  const [statusHost, setStatusHost] = useState<HTMLDivElement | null>(null);
  const [timelineReady, setTimelineReady] = useState(false);
  const [claimedJobIds, setClaimedJobIds] = useState<ReadonlySet<string>>(() => new Set());
  const claimJobId = useCallback((id: string) => {
    setClaimedJobIds((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }, []);
  const [alignmentRequest, setAlignmentRequest] = useState(0);
  const [alignmentScope, setAlignmentScope] = useState<string[] | null>(null);
  const requestAlignmentOpen = useCallback((scopeIds: string[] | null = null) => { setAlignmentScope(scopeIds); setAlignmentRequest((v) => v + 1); }, []);
  return { uploadHost, setUploadHost, analysisHost, setAnalysisHost, selected, setSelected, segmentTarget, adding, setAdding, toolsHost, setToolsHost, alignmentHost, setAlignmentHost, statusHost, setStatusHost, timelineReady, setTimelineReady, claimedJobIds, claimJobId, alignmentRequest, alignmentScope, requestAlignmentOpen };
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
