import { createContext, useContext, useState, type ReactNode } from 'react';
function useAudioState() {
  const [selected, setSelected] = useState<string[]>([]);
  const [segmentTarget, setSegmentTarget] = useState(false);
  const [adding, setAdding] = useState(false);
  const [toolsHost, setToolsHost] = useState<HTMLDivElement | null>(null);
  const [statusHost, setStatusHost] = useState<HTMLDivElement | null>(null);
  const [timelineReady, setTimelineReady] = useState(false);
  return { selected, setSelected, segmentTarget, setSegmentTarget, adding, setAdding, toolsHost, setToolsHost, statusHost, setStatusHost, timelineReady, setTimelineReady };
}
const Context = createContext<ReturnType<typeof useAudioState> | null>(null);
export const useAudioReview = () => useContext(Context)!;
export function AudioReviewProvider({ children }: { children: ReactNode }) {
  return <Context.Provider value={useAudioState()}>{children}</Context.Provider>;
}
