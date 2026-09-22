import type { StudioLine, StudioRuby, TimingUnit } from "./document";

const points = (text: string) => Array.from(text);
const shiftRuby = (span: StudioRuby, delta: number): StudioRuby => ({
  ...span,
  baseStart: span.baseStart - delta,
  baseEnd: span.baseEnd - delta,
});
const shiftUnit = (
  unit: TimingUnit,
  delta: number,
  id: string = unit.id,
): TimingUnit => ({
  ...unit,
  id,
  textStart: unit.textStart - delta,
  textEnd: unit.textEnd - delta,
});

export function splitLineStructure(
  line: StudioLine,
  at: number,
  secondId: string,
): [StudioLine, StudioLine] {
  const text = points(line.text);
  if (at <= 0 || at >= text.length)
    throw new Error("Split position must be inside line text");
  if (
    line.ruby.some((span) => at > span.baseStart && at < span.baseEnd) ||
    line.timingUnits.some((unit) => at > unit.textStart && at < unit.textEnd)
  )
    throw new Error("Split cannot cut inside Ruby or timing unit");
  const firstText = text.slice(0, at).join(""),
    secondText = text.slice(at).join("");
  const firstRuby = line.ruby.filter((span) => span.baseEnd <= at);
  const secondRuby = line.ruby
    .filter((span) => span.baseStart >= at)
    .map((span) => shiftRuby(span, at));
  const firstUnits = line.timingUnits.filter((unit) => unit.textEnd <= at);
  const secondUnits = line.timingUnits
    .filter((unit) => unit.textStart >= at)
    .map((unit) => {
      const ruby = line.ruby.find((item) => item.id === unit.rubyId);
      const mappedRuby = ruby && ruby.baseStart >= at ? ruby.id : unit.rubyId;
      return {
        ...shiftUnit(unit, at),
        rubyId: mappedRuby,
      };
    });
  const boundary = line.timingUnits.find(
    (unit) => unit.textStart === at || unit.textEnd === at,
  );
  const splitTime = boundary
    ? boundary.textStart === at
      ? boundary.beginUs
      : boundary.endUs
    : null;
  const base = (
    value: StudioLine,
    id: string,
    body: string,
    ruby: StudioRuby[],
    units: TimingUnit[],
    beginUs: StudioLine["beginUs"],
    endUs: StudioLine["endUs"],
  ): StudioLine => ({
    ...value,
    id,
    xmlId: id === line.id ? line.xmlId : id,
    sourcePath: id === line.id ? line.sourcePath : [],
    sourceAttributes: line.sourceAttributes.map((attribute) => ({ ...attribute })),
    text: body,
    inline: [{ kind: "text", text: body, editable: true }],
    ruby,
    timingUnits: units,
    beginUs,
    endUs,
    baseline: { ...value.baseline },
  });
  const first = base(
    line,
    line.id,
    firstText,
    firstRuby,
    firstUnits,
    line.beginUs,
    splitTime,
  );
  const second = base(
    line,
    secondId,
    secondText,
    secondRuby,
    secondUnits,
    splitTime,
    line.endUs,
  );
  second.sourceLineId = line.id;
  return [first, second];
}

export function mergeLineStructure(
  first: StudioLine,
  second: StudioLine,
): StudioLine {
  if (
    first.parentPath.join(".") !== second.parentPath.join(".") ||
    JSON.stringify(first.agentRefs) !== JSON.stringify(second.agentRefs)
  )
    throw new Error(
      "Only adjacent lines with the same parent and agent can merge",
    );
  const structuralAttributes = (line: StudioLine) => line.sourceAttributes
    .filter((attribute) => !((attribute.namespaceURI === 'http://www.w3.org/2000/xmlns/') ||
      (attribute.namespaceURI === null && ['begin', 'end', 'dur'].includes(attribute.localName)) ||
      (attribute.namespaceURI === 'http://www.w3.org/XML/1998/namespace' && attribute.localName === 'id') ||
      (attribute.namespaceURI === 'urn:lazulite:studio:draft' && attribute.localName === 'null') ||
      (attribute.namespaceURI === 'http://www.w3.org/ns/ttml#metadata' && attribute.localName === 'agent')))
    .map((attribute) => [attribute.namespaceURI, attribute.localName, attribute.value])
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  if (JSON.stringify(structuralAttributes(first)) !== JSON.stringify(structuralAttributes(second)))
    throw new Error("Cannot merge lines with different attributes");
  const unitIds = [...first.timingUnits, ...second.timingUnits].map((unit) => unit.id);
  if (unitIds.some((id, index) => unitIds.indexOf(id) !== index))
    throw new Error("Cannot merge lines with duplicate timing unit ids");
  const offset = points(first.text).length;
  const ruby = [
    ...first.ruby,
    ...second.ruby.map((span) => ({
      ...span,
      baseStart: span.baseStart + offset,
      baseEnd: span.baseEnd + offset,
    })),
  ];
  const timingUnits = [
    ...first.timingUnits,
    ...second.timingUnits.map((unit) => ({
      ...unit,
      id: unit.id,
      rubyId: unit.rubyId,
      textStart: unit.textStart + offset,
      textEnd: unit.textEnd + offset,
    })),
  ];
  const text = first.text + second.text;
  return {
    ...first,
    text,
    inline: [{ kind: "text", text, editable: true }],
    ruby,
    timingUnits,
    endUs: second.endUs,
    baseline: { ...first.baseline },
  };
}
