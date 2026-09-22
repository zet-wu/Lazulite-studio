import type { TimingUnit, StudioLine } from "../../domain/document";

const points = (value: string) => Array.from(value);
const textOf = (node: Node) => node.textContent || "";

/** Walks rendered TTML text in DOM order. Ruby reading is excluded from正文 coordinates. */
export function renderedTextLength(node: Element, ttmlNs: string): number {
  if (
    node.namespaceURI === ttmlNs &&
    node.getAttributeNS("http://www.w3.org/ns/ttml#styling", "ruby") === "text"
  )
    return 0;
  const base =
    node.namespaceURI === ttmlNs &&
    node.getAttributeNS("http://www.w3.org/ns/ttml#styling", "ruby") === "base";
  if (base) return points(textOf(node)).length;
  return Array.from(node.childNodes).reduce(
    (sum, child) =>
      sum +
      (child.nodeType === Node.ELEMENT_NODE
        ? renderedTextLength(child as Element, ttmlNs)
        : points(child.nodeValue || "").length),
    0,
  );
}

const rubyAttr = (node: Element, kind: string) =>
  node.getAttributeNS("http://www.w3.org/ns/ttml#styling", "ruby") === kind;
const TTML_NS = "http://www.w3.org/ns/ttml";
const STUDIO_DRAFT_NS = "urn:lazulite:studio:draft";

function timedSpan(
  doc: Document,
  unit: TimingUnit,
  lineStart: number,
  ttmlNs: string,
  studioNs: string,
): Element {
  if (
    (unit.beginUs !== null && unit.beginUs < lineStart) ||
    (unit.endUs !== null && unit.endUs < lineStart)
  )
    throw new Error(`Timing unit ${unit.id} precedes its line`);
  const span = doc.createElementNS(ttmlNs, "span");
  span.setAttributeNS(studioNs, "studio:id", unit.id);
  span.setAttributeNS(studioNs, "studio:kind", unit.kind);
  if (unit.beginUs !== null)
    span.setAttribute("begin", `${(unit.beginUs - lineStart) / 1_000_000}s`);
  if (unit.endUs !== null)
    span.setAttribute("end", `${(unit.endUs - lineStart) / 1_000_000}s`);
  const nulls = [
    unit.beginUs === null ? "begin" : "",
    unit.endUs === null ? "end" : "",
  ]
    .filter(Boolean)
    .join(" ");
  if (nulls) span.setAttributeNS(studioNs, "studio:null", nulls);
  return span;
}

function writePart(
  part: Element,
  text: string,
  units: TimingUnit[],
  startOffset: number,
  lineStart: number,
  ttmlNs: string,
  studioNs: string,
): void {
  const points = Array.from(text);
  const sorted = units
    .slice()
    .sort((a, b) => a.textStart - b.textStart || a.textEnd - b.textEnd);
  let cursor = 0;
  const fragment = part.ownerDocument!.createDocumentFragment();
  for (const unit of sorted) {
    const start = unit.textStart - startOffset,
      end = unit.textEnd - startOffset;
    if (start < cursor || start < 0 || end < start || end > points.length)
      throw new Error(
        `Timing unit ${unit.id} crosses an unrepresentable Ruby boundary`,
      );
    if (start > cursor)
      fragment.appendChild(
        part.ownerDocument!.createTextNode(
          points.slice(cursor, start).join(""),
        ),
      );
    const span = timedSpan(
      part.ownerDocument!,
      unit,
      lineStart,
      ttmlNs,
      studioNs,
    );
    span.appendChild(
      part.ownerDocument!.createTextNode(points.slice(start, end).join("")),
    );
    fragment.appendChild(span);
    cursor = end;
  }
  if (cursor < points.length)
    fragment.appendChild(
      part.ownerDocument!.createTextNode(points.slice(cursor).join("")),
    );
  part.replaceChildren(fragment);
}

/** Rebuilds all fine timing in one pass. Body and Ruby-reading coordinates are independent. */
export function writeUnitTiming(element: Element, line: StudioLine): void {
  const doc = element.ownerDocument!;
  const lineStart = line.beginUs ?? line.sourceTiming.parentBeginUs;
  const rubies = line.ruby.slice().sort((a, b) => a.baseStart - b.baseStart);
  const rubyElements = Array.from(element.children).filter((node) =>
    rubyAttr(node, "container"),
  );
  if (rubyElements.length !== rubies.length)
    throw new Error(`Line ${line.id} Ruby structure does not match its model`);

  // Reject body units which span a Ruby boundary: there is no single TTML node to represent them.
  const bodyUnits = line.timingUnits
    .filter((unit) => unit.rubyId === null)
    .sort((a, b) => a.textStart - b.textStart);
  for (const unit of bodyUnits) {
    if (
      rubies.some(
        (r) =>
          unit.textStart < r.baseEnd &&
          unit.textEnd > r.baseStart &&
          !(unit.textStart >= r.baseStart && unit.textEnd <= r.baseEnd),
      )
    )
      throw new Error(`Timing unit ${unit.id} crosses a Ruby boundary`);
  }
  // Reconstruct body children directly to avoid nested spans after repeated edits.
  const bodyFragment = doc.createDocumentFragment();
  let cursor = 0;
  for (const [rubyIndex, ruby] of rubies.entries()) {
    if (ruby.baseStart < cursor)
      throw new Error(`Line ${line.id} has overlapping Ruby ranges`);
    const plain = Array.from(line.text).slice(cursor, ruby.baseStart).join("");
    const plainUnits = bodyUnits
      .filter((u) => u.textStart >= cursor && u.textEnd <= ruby.baseStart)
      .map((u) => ({
        ...u,
        textStart: u.textStart - cursor,
        textEnd: u.textEnd - cursor,
      }));
    const holder = doc.createElementNS(TTML_NS, "span");
    writePart(
      holder,
      plain,
      plainUnits,
      0,
      lineStart,
      TTML_NS,
      STUDIO_DRAFT_NS,
    );
    while (holder.firstChild) bodyFragment.appendChild(holder.firstChild);
    const clone = rubyElements[rubyIndex].cloneNode(true) as Element;
    const base = Array.from(clone.children).find((c) => rubyAttr(c, "base"));
    const reading = Array.from(clone.children).find((c) => rubyAttr(c, "text"));
    if (!base || !reading)
      throw new Error(`Line ${line.id} Ruby container is incomplete`);
    const baseUnits = line.timingUnits.filter(
      (u) =>
        u.rubyId === null &&
        u.textStart >= ruby.baseStart &&
        u.textEnd <= ruby.baseEnd,
    );
    writePart(
      base,
      ruby.base,
      baseUnits,
      ruby.baseStart,
      lineStart,
      TTML_NS,
      STUDIO_DRAFT_NS,
    );
    const readingUnits = line.timingUnits
      .filter(
        (u) =>
          u.rubyId === ruby.id &&
          u.readingStart !== null &&
          u.readingEnd !== null,
      )
      .map((u) => ({
        ...u,
        textStart: u.readingStart!,
        textEnd: u.readingEnd!,
      }));
    writePart(
      reading,
      ruby.reading,
      readingUnits,
      0,
      lineStart,
      TTML_NS,
      STUDIO_DRAFT_NS,
    );
    bodyFragment.appendChild(clone);
    cursor = ruby.baseEnd;
  }
  const tail = Array.from(line.text).slice(cursor).join("");
  const tailUnits = bodyUnits
    .filter((u) => u.textStart >= cursor)
    .map((u) => ({
      ...u,
      textStart: u.textStart - cursor,
      textEnd: u.textEnd - cursor,
    }));
  const tailHolder = doc.createElementNS(TTML_NS, "span");
  writePart(
    tailHolder,
    tail,
    tailUnits,
    0,
    lineStart,
    TTML_NS,
    STUDIO_DRAFT_NS,
  );
  while (tailHolder.firstChild) bodyFragment.appendChild(tailHolder.firstChild);
  element.replaceChildren(bodyFragment);
}
