import type { LyricDocument, TimeMs } from './lyric-document';

type Interval = { beginMs: TimeMs; endMs: TimeMs };
const endpoints = (items: Interval[]) => items.flatMap(item => [item.beginMs, item.endMs]).filter((time): time is number => time !== null);

/** Display-only copies. Never pass this projection to commands, playback or persistence. */
export function projectTimeline(document: LyricDocument, durationMs: number | null = null): LyricDocument {
  const duration = durationMs !== null && Number.isFinite(durationMs) && durationMs >= 0 ? durationMs : null;
  const legal = (time: number) => Number.isFinite(time) && time >= 0 && (duration === null || time <= duration);
  function project<T extends Interval & { id: string }>(item: T, previous?: Interval, next?: Interval, parent?: Interval, children: Interval[] = []): T {
    if ((item.beginMs === null) === (item.endMs === null)) return { ...item };
    const missingBegin = item.beginMs === null;
    const known = (missingBegin ? item.endMs : item.beginMs)!;
    if (!legal(known)) return { ...item };
    const bounds = endpoints(children);
    const candidates = missingBegin ? [previous?.endMs, parent?.beginMs, 0] : [next?.beginMs, parent?.endMs, duration];
    const values = candidates.filter((value): value is number => value != null && legal(value)
      && (missingBegin ? value < known || value === known && known === 0 : value > known || value === known && known === duration)
      && bounds.every(bound => missingBegin ? value <= bound && bound <= known : known <= bound && bound <= value));
    if (!values.length) return { ...item };
    return { ...item, [missingBegin ? 'beginMs' : 'endMs']: missingBegin ? Math.max(...values) : Math.min(...values) };
  }
  const lines = document.lines.map((line, index) => {
    const shown = project(line, document.lines[index - 1], document.lines[index + 1], undefined, line.words.flatMap(word => [word, ...word.rubyUnits]));
    return { ...shown, words: line.words.map((word, i) => {
      const shownWord = project(word, line.words[i - 1], line.words[i + 1], shown, word.rubyUnits);
      return { ...shownWord, rubyUnits: word.rubyUnits.map((unit, j) => project(unit, word.rubyUnits[j - 1], word.rubyUnits[j + 1], shownWord)) };
    }) };
  });
  const byId = new Map(lines.map(line => [line.id, line]));
  return { ...document, lines, romanizationTracks: document.romanizationTracks.map(track => ({ ...track, contents: track.contents.map(content => content.kind === 'plain' ? content : {
    ...content, units: content.units.map((unit, index) => project(unit, content.units[index - 1], content.units[index + 1], byId.get(content.lineId))),
  }) })) };
}
