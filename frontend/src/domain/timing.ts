import type { StudioLine, TimingUnit } from "./document";
export function validateTimingUnitsForLine(
  line: StudioLine,
  units: TimingUnit[],
): void {
  const text = Array.from(line.text),
    seen = new Set<string>(),
    textRanges: Array<[number, number]> = [],
    readingRanges = new Map<string, Array<[number, number]>>();
  for (const unit of units) {
    if (
      !unit.id ||
      seen.has(unit.id) ||
      !["word", "mora", "phoneme"].includes(unit.kind)
    )
      throw new Error("Timing unit ids and kind must be valid");
    seen.add(unit.id);
    if (
      ![unit.textStart, unit.textEnd].every(Number.isSafeInteger) ||
      unit.textStart < 0 ||
      unit.textEnd <= unit.textStart ||
      unit.textEnd > text.length
    )
      throw new Error(
        "Timing unit text range must be a non-empty code-point range",
      );
    const ranges = readingRanges.get(unit.rubyId ?? "") ?? [];
    if (unit.rubyId !== null) {
      const ruby = line.ruby.find((item) => item.id === unit.rubyId);
      if (
        !ruby ||
        unit.textStart !== ruby.baseStart ||
        unit.textEnd !== ruby.baseEnd ||
        !Number.isSafeInteger(unit.readingStart) ||
        !Number.isSafeInteger(unit.readingEnd) ||
        unit.readingStart! < 0 ||
        unit.readingEnd! <= unit.readingStart! ||
        unit.readingEnd! > Array.from(ruby.reading).length
      )
        throw new Error("Timing unit reading range is invalid");
      if (
        ranges.some(
          ([start, end]) =>
            unit.readingStart! < end && start < unit.readingEnd!,
        )
      )
        throw new Error("Timing unit reading ranges must not overlap");
      ranges.push([unit.readingStart!, unit.readingEnd!]);
      readingRanges.set(unit.rubyId ?? "", ranges);
    } else if (unit.readingStart !== null || unit.readingEnd !== null)
      throw new Error("Reading range requires a Ruby span");
    else {
      if (
        line.ruby.some(
          (ruby) =>
            unit.textStart < ruby.baseEnd &&
            ruby.baseStart < unit.textEnd &&
            !(unit.textStart >= ruby.baseStart && unit.textEnd <= ruby.baseEnd),
        )
      )
        throw new Error("Timing unit crosses an unrepresentable Ruby boundary");
      if (
        textRanges.some(
          ([start, end]) => unit.textStart < end && start < unit.textEnd,
        )
      )
        throw new Error("Timing unit text ranges must not overlap");
      textRanges.push([unit.textStart, unit.textEnd]);
    }
    if (
      [unit.beginUs, unit.endUs].some(
        (value) =>
          value !== null && (!Number.isSafeInteger(value) || value < 0),
      ) ||
      (unit.beginUs !== null &&
        unit.endUs !== null &&
        unit.endUs < unit.beginUs)
    )
      throw new Error("Timing unit time is invalid");
    for (const time of [unit.beginUs, unit.endUs]) {
      if (time !== null && line.beginUs !== null && time < line.beginUs)
        throw new Error("Timing unit precedes line bounds");
      if (time !== null && line.endUs !== null && time > line.endUs)
        throw new Error("Timing unit exceeds line bounds");
    }
  }
}
