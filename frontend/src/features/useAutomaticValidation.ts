import { errorMessage, type Message } from '../domain/messages';
import { useEffect, useState } from 'react';
import { checkAmll, type AmllResults } from '../domain/amll-compatibility';
import type { LyricDocument } from '../domain/lyric-document';

export function useAutomaticValidation(document: LyricDocument, projectId?: string) {
  const [result, setResult] = useState<{ document: LyricDocument; projectId: string | undefined; amll?: AmllResults; error?: Message } | null>(null);
  useEffect(() => {
    let cancelled = false;
    // Coalesce committed changes and let the pending status paint before computation.
    const timer = setTimeout(() => {
      try {
        const amll = checkAmll(document);
        if (!cancelled) setResult({ document, projectId, amll });
      } catch (error) {
        if (!cancelled) setResult({ document, projectId, error: errorMessage(error) });
      }
    }, 0);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [document, projectId]);
  return { result, current: result?.document === document && result?.projectId === projectId };
}
