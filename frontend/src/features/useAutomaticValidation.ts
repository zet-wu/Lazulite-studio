import { errorMessage, type Message } from '../domain/messages';
import { audioRangeIssues } from '../adapters/audio-validation';
import type { Acoustics } from '../domain/project-document';
import { useEffect, useMemo, useState } from 'react';
import { validateLyricsIncrementally } from '../adapters/lyric-validation';
import type { OutputIssue } from '../adapters/output-validation';
import { checkAmll, type AmllResults } from '../domain/amll-compatibility';
import type { LyricDocument } from '../domain/lyric-document';
import type { ProjectEditing } from '../domain/project-editing';
export type ValidationTab = 'lyrics' | 'amll';
export function useAutomaticValidation(document: LyricDocument, editing: ProjectEditing, projectId: string | undefined, tab: ValidationTab, acoustics?: Acoustics, assetId?: string, durationMs?: number) {
  const lyricEditing = tab === 'lyrics' ? editing : undefined;
  const input = useMemo(() => ({document, editing: lyricEditing, projectId, tab}), [document, lyricEditing, projectId, tab]);
  const audioIssues = useMemo(() => tab === 'lyrics' ? audioRangeIssues(document, acoustics, assetId, durationMs) : [], [tab, document, acoustics, assetId, durationMs]);
  const [result, setResult] = useState<{input: typeof input; issues?: OutputIssue[]; amll?: AmllResults; error?: Message} | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    // Coalesce committed changes and let the pending status paint before computation.
    const timer = setTimeout(async () => {
      try {
        const next = tab === 'lyrics' ? {issues: document.lines.length === 0 ? [] : await validateLyricsIncrementally(document, editing, controller.signal)} : {amll: checkAmll(document)};
        if (!controller.signal.aborted) setResult({input, ...next});
      } catch (error) {
        if (!controller.signal.aborted) setResult({input, error: errorMessage(error)});
      }
    }, 0);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [input]);
  return { result: result?.input.tab === tab ? {...result, issues: result.issues ? [...result.issues, ...audioIssues] : undefined} : null, current: result?.input === input };
}
