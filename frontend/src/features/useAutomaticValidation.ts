import { useEffect, useMemo, useState } from 'react';
import { validateLyricsIncrementally } from '../adapters/lyric-validation';
import type { OutputIssue } from '../adapters/output-validation';
import { checkAmll, type AmllResults, type AmllSettings } from '../domain/amll-compatibility';
import type { LyricDocument } from '../domain/lyric-document';
import type { ProjectEditing } from '../domain/project-editing';
export type ValidationTab = 'lyrics' | 'amll';
export function useAutomaticValidation(document: LyricDocument, editing: ProjectEditing, amll: AmllSettings | undefined, projectId: string | undefined, tab: ValidationTab) {
  const input = useMemo(() => ({document, editing, amll, projectId, tab}), [document, editing, amll, projectId, tab]);
  const [result, setResult] = useState<{input: typeof input; issues?: OutputIssue[]; amll?: AmllResults; error?: string} | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    // Coalesce committed changes and let the pending status paint before computation.
    const timer = setTimeout(async () => {
      try {
        const next = tab === 'lyrics' ? {issues: await validateLyricsIncrementally(document, editing, controller.signal)} : {amll: checkAmll(document)};
        if (!controller.signal.aborted) setResult({input, ...next});
      } catch (error) {
        if (!controller.signal.aborted) setResult({input, error: error instanceof Error ? error.message : String(error)});
      }
    }, 0);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [input]);
  return { result: result?.input.tab === tab ? result : null, current: result?.input === input };
}
