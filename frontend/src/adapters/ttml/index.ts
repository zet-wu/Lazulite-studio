import type { TtmlAttribute, TtmlDocument, TtmlIssue, TtmlLine, TtmlNode, TimeUs } from '../../domain/ttml';

export const TTML_NS = 'http://www.w3.org/ns/ttml';
export const TTM_NS = 'http://www.w3.org/ns/ttml#metadata';
export const TTS_NS = 'http://www.w3.org/ns/ttml#styling';
export const TTP_NS = 'http://www.w3.org/ns/ttml#parameter';
const XML_NS = 'http://www.w3.org/XML/1998/namespace';
const XMLNS_NS = 'http://www.w3.org/2000/xmlns/';
const MAX_XML_BYTES = 2 * 1024 * 1024;
const MAX_DEPTH = 128;

const local = (node: Element) => node.localName || node.tagName.replace(/^.*:/, '');
const attr = (node: Element, namespaceURI: string | null, name: string) =>
  Array.from(node.attributes).find((item) => item.localName === name && item.namespaceURI === namespaceURI)?.value ?? null;
const ttmAgent = (node: Element) => attr(node, TTM_NS, 'agent');
const ttsRuby = (node: Element) => attr(node, TTS_NS, 'ruby');

function toTree(node: Node): TtmlNode {
  switch (node.nodeType) {
    case Node.TEXT_NODE: return { type: 'text', value: node.nodeValue || '' };
    case Node.CDATA_SECTION_NODE: return { type: 'cdata', value: node.nodeValue || '' };
    case Node.COMMENT_NODE: return { type: 'comment', value: node.nodeValue || '' };
    case Node.PROCESSING_INSTRUCTION_NODE: return { type: 'processing-instruction', target: (node as ProcessingInstruction).target, value: node.nodeValue || '' };
    case Node.ELEMENT_NODE: {
      const element = node as Element;
      return { type: 'element', namespaceURI: element.namespaceURI, localName: local(element), prefix: element.prefix,
        attributes: Array.from(element.attributes).map((item): TtmlAttribute => ({ namespaceURI: item.namespaceURI, localName: item.localName, prefix: item.prefix, name: item.name, value: item.value })),
        children: Array.from(element.childNodes).map(toTree) };
    }
    default: throw new Error(`Unsupported XML node type ${node.nodeType}`);
  }
}

export function parseTime(value: string | null): TimeUs {
  if (value === null) return null;
  const input = value.trim();
  let seconds: number;
  if (/^\d+(?:\.\d+)?s$/.test(input)) seconds = Number.parseFloat(input);
  else if (/^\d+(?:\.\d+)?ms$/.test(input)) seconds = Number.parseFloat(input) / 1000;
  else {
    const match = /^(\d+):(\d{2}):(\d{2})(?:\.(\d+))?$/.exec(input);
    if (!match || Number(match[2]) >= 60 || Number(match[3]) >= 60) return null;
    seconds = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + (match[4] ? Number(`0.${match[4]}`) : 0);
  }
  const microseconds = Math.round(seconds * 1_000_000);
  return Number.isSafeInteger(microseconds) && microseconds >= 0 ? microseconds : null;
}

type Timing = { begin: number | null; end: number | null; unknown: boolean };
const safeAdd = (left: number, right: number) => {
  const result = left + right;
  return Number.isSafeInteger(result) ? result : null;
};
function timing(node: Element, parent: Timing, issues: TtmlIssue[], path: number[]): Timing {
  const beginRaw = attr(node, null, 'begin'); const endRaw = attr(node, null, 'end'); const durRaw = attr(node, null, 'dur');
  const begin = parseTime(beginRaw); const end = parseTime(endRaw); const dur = parseTime(durRaw);
  const invalid = ([['begin', beginRaw, begin], ['end', endRaw, end], ['dur', durRaw, dur]] as const).some(([name, raw, parsed]) => {
    if (raw !== null && parsed === null) issues.push({ code: 'unsupported-time', message: `${name}="${raw}" is not supported`, path });
    return raw !== null && parsed === null;
  });
  const timeBase = attr(node, null, 'timeBase') ?? attr(node, TTP_NS, 'timeBase');
  const nonMedia = timeBase !== null && timeBase !== 'media';
  if (nonMedia) issues.push({ code: 'unsupported-time-base', message: `timeBase="${timeBase}" is read-only`, path });
  if (invalid || nonMedia || parent.unknown || parent.begin === null) return { begin: null, end: null, unknown: true };
  const nextBegin = safeAdd(parent.begin, begin ?? 0);
  if (nextBegin === null) {
    issues.push({ code: 'unsafe-time', message: 'Timing exceeds safe integer microseconds', path });
    return { begin: null, end: null, unknown: true };
  }
  const candidates = [parent.end];
  if (end !== null) {
    const value = safeAdd(parent.begin, end);
    if (value === null) {
      issues.push({ code: 'unsafe-time', message: 'Timing exceeds safe integer microseconds', path });
      return { begin: null, end: null, unknown: true };
    }
    candidates.push(value);
  }
  if (dur !== null) {
    const value = safeAdd(nextBegin, dur);
    if (value === null) {
      issues.push({ code: 'unsafe-time', message: 'Timing exceeds safe integer microseconds', path });
      return { begin: null, end: null, unknown: true };
    }
    candidates.push(value);
  }
  const nextEnd = candidates.filter((value): value is number => value !== null).reduce((min, value) => Math.min(min, value), Number.POSITIVE_INFINITY);
  if (Number.isFinite(nextEnd) && nextEnd < nextBegin) {
    issues.push({ code: 'invalid-time-range', message: 'Timing end precedes begin', path });
    return { begin: null, end: null, unknown: true };
  }
  return { begin: nextBegin, end: Number.isFinite(nextEnd) ? nextEnd : null, unknown: false };
}

const cpLength = (value: string) => Array.from(value).length;
function textAndRuby(node: Element, issues: TtmlIssue[], path: number[]) {
  let text = ''; const ruby: TtmlLine['ruby'] = [];
  const rubyPartText = (part: Element): string | null => {
    if (part.namespaceURI !== TTML_NS) return null;
    let value = '';
    for (const child of Array.from(part.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE || child.nodeType === Node.CDATA_SECTION_NODE) value += child.nodeValue || '';
      else return null;
    }
    return value;
  };
  const visit = (current: Node): void => {
    if (current.nodeType === Node.TEXT_NODE || current.nodeType === Node.CDATA_SECTION_NODE) { text += current.nodeValue || ''; return; }
    if (current.nodeType !== Node.ELEMENT_NODE) return;
    const element = current as Element;
    if (element.namespaceURI !== TTML_NS) return;
    if (local(element) === 'metadata') return;
    if (local(element) === 'br') { text += '\n'; return; }
    const value = ttsRuby(element);
    if (value === 'text') return;
    if (value === 'container') {
      const children = Array.from(element.children); const base = children.find((child) => child.namespaceURI === TTML_NS && ttsRuby(child) === 'base'); const reading = children.find((child) => child.namespaceURI === TTML_NS && ttsRuby(child) === 'text');
      const baseText = base ? rubyPartText(base) : null; const readingText = reading ? rubyPartText(reading) : null;
      if (!base || !reading || baseText === null || readingText === null || children.length !== 2) { issues.push({ code: 'unsupported-ruby', message: 'Only one simple ruby container(base,text) is understood', path }); return; }
      const start = cpLength(text); visit(base); const end = cpLength(text);
      ruby.push({ base: baseText, reading: readingText, baseStart: start, baseEnd: end }); return;
    }
    if (value === 'baseContainer' || value === 'textContainer') { issues.push({ code: 'unsupported-ruby', message: 'Ruby baseContainer/textContainer is read-only', path }); return; }
    if (value !== null && value !== 'none' && value !== 'base') {
      issues.push({ code: 'unsupported-ruby', message: `Ruby value "${value}" is not supported`, path });
      return;
    }
    if (!knownElements.has(local(element))) return;
    Array.from(element.childNodes).forEach(visit);
  };
  Array.from(node.childNodes).forEach(visit); return { text, ruby };
}

const knownElements = new Set(['tt', 'head', 'body', 'div', 'p', 'span', 'br', 'metadata']);
const knownPlainAttributes = new Set(['begin', 'end', 'dur', 'timeContainer', 'timeBase', 'type']);
function inspect(node: Element, issues: TtmlIssue[], path: number[], inMetadata: boolean) {
  if (node.namespaceURI === TTML_NS && !knownElements.has(local(node))) issues.push({ code: 'unknown-element', message: `Unknown TTML element ${local(node)}`, path });
  if (node.namespaceURI !== TTML_NS && node.namespaceURI !== TTM_NS && node.namespaceURI !== TTS_NS) issues.push({ code: 'unknown-namespace', message: `Unknown namespace ${node.namespaceURI || '(none)'}`, path });
  for (const item of Array.from(node.attributes)) {
    const known = item.namespaceURI === XMLNS_NS || item.namespaceURI === XML_NS || (item.namespaceURI === null && knownPlainAttributes.has(item.localName)) || item.namespaceURI === TTM_NS || item.namespaceURI === TTS_NS || item.namespaceURI === TTP_NS;
    if (!known) issues.push({ code: 'unknown-attribute', message: `Unknown attribute ${item.name}`, path });
  }
  if (inMetadata && node.namespaceURI === TTM_NS && local(node) === 'agent' && !attr(node, XML_NS, 'id')) issues.push({ code: 'invalid-agent', message: 'ttm:agent requires xml:id', path });
}

export function importTtml(xml: string): TtmlDocument {
  if (new TextEncoder().encode(xml).byteLength > MAX_XML_BYTES) throw new Error('TTML exceeds 2 MiB limit');
  if (/<!DOCTYPE/i.test(xml) || /<!ENTITY/i.test(xml)) throw new Error('DTD and external entities are not accepted');
  const parsed = new DOMParser().parseFromString(xml, 'application/xml'); const root = parsed.documentElement;
  if (!root || parsed.getElementsByTagName('parsererror')[0]) throw new Error('Invalid XML');
  if (root.namespaceURI !== TTML_NS || local(root) !== 'tt') throw new Error('Root must be TTML tt element');
  const issues: TtmlIssue[] = []; const lines: TtmlLine[] = [];
  const walk = (node: Element, parent: Timing, path: number[], metadata = false, depth = 1): void => {
    if (depth > MAX_DEPTH) throw new Error('TTML nesting exceeds depth 128');
    const isMetadata = metadata || (node.namespaceURI === TTML_NS && local(node) === 'metadata'); inspect(node, issues, path, isMetadata);
    let current = timing(node, parent, issues, path);
    if (attr(node, null, 'timeContainer') === 'seq') {
      issues.push({ code: 'unsupported-seq', message: 'Sequential timing is read-only', path });
      current = { begin: null, end: null, unknown: true };
    }
    if (!isMetadata && node.namespaceURI === TTML_NS && local(node) === 'p') {
      const content = textAndRuby(node, issues, path); lines.push({ id: attr(node, XML_NS, 'id'), text: content.text, beginUs: current.begin, endUs: current.end, agent: ttmAgent(node), ruby: content.ruby, sourcePath: path });
    }
    Array.from(node.children).forEach((child, index) => walk(child, current, [...path, index], isMetadata, depth + 1));
  };
  walk(root, { begin: 0, end: null, unknown: false }, []); return { rawXml: xml, root: toTree(root), lines, issues, canEdit: false };
}

export function serializeOriginal(document: TtmlDocument) { return document.rawXml; }
export function serializeWithXmlSerializer(xml: string) { const document = new DOMParser().parseFromString(xml, 'application/xml'); if (document.getElementsByTagName('parsererror')[0]) throw new Error('Invalid XML'); return new XMLSerializer().serializeToString(document); }
