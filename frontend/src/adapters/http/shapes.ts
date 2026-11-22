import { apiJson } from './client';
import { shapeRows, type ShapeTarget } from '../../domain/shape-conversion';
import { lineText, type LyricDocument } from '../../domain/lyric-document';

export async function analyzeShapes(source: LyricDocument, ids: string[], target: ShapeTarget, signal: AbortSignal) {
  const result = await apiJson<Parameters<typeof shapeRows>[2]>('/shapes/analyze', {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      target,
      lines: source.lines.filter(line => ids.includes(line.id)).map(line => ({ id: line.id, text: lineText(line) })),
    }),
  });
  return shapeRows(source, ids, result);
}
