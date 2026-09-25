import { createWord, LYRIC_SCHEMA_VERSION, type LyricAgent, type LyricDocument, type LyricLine, type LyricWord, type RubyUnit, type TimeUs } from '../../domain/lyric-document';

const TTML = 'http://www.w3.org/ns/ttml';
const TTS = 'http://www.w3.org/ns/ttml#styling';
const TTM = 'http://www.w3.org/ns/ttml#metadata';
const XML = 'http://www.w3.org/XML/1998/namespace';
const STUDIO = 'urn:lazulite:studio:draft';
const MAX_BYTES = 2 * 1024 * 1024;

const attr = (node: Element, ns: string | null, name: string) => node.getAttributeNS(ns, name);
const is = (node: Element, ns: string, name: string) => node.namespaceURI === ns && node.localName === name;

function parseTime(value: string): number {
  const raw = value.trim();
  let seconds: number;
  if (/^\d+(?:\.\d+)?ms$/.test(raw)) seconds = Number(raw.slice(0, -2)) / 1000;
  else if (/^\d+(?:\.\d+)?s$/.test(raw)) seconds = Number(raw.slice(0, -1));
  else {
    const match = /^(\d+):(\d{2}):(\d{2})(?:\.(\d+))?$/.exec(raw);
    if (!match || Number(match[2]) >= 60 || Number(match[3]) >= 60) throw new Error(`Unsupported TTML time: ${value}`);
    seconds = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(`0.${match[4] ?? '0'}`);
  }
  const us = Math.round(seconds * 1_000_000);
  if (!Number.isSafeInteger(us)) throw new Error(`TTML time exceeds microsecond range: ${value}`);
  return us;
}

function timeText(us: number) {
  return `${(us / 1_000_000).toFixed(6).replace(/0+$/, '').replace(/\.$/, '')}s`;
}

function boundaries(node: Element, parentStart: number, parentEnd: TimeUs): [TimeUs, TimeUs] {
  if (attr(node, null, 'timeContainer') === 'seq') throw new Error('Sequential TTML timing is not supported');
  const beginRaw = attr(node, null, 'begin');
  const endRaw = attr(node, null, 'end');
  const durRaw = attr(node, null, 'dur');
  const nulls = (attr(node, STUDIO, 'null') ?? '').split(/\s+/);
  const begin = nulls.includes('begin') ? null : beginRaw === null ? null : parentStart + parseTime(beginRaw);
  const endFromEnd = endRaw === null ? null : parentStart + parseTime(endRaw);
  const endFromDur = durRaw === null ? null : (begin ?? parentStart) + parseTime(durRaw);
  const end = nulls.includes('end') ? null : [endFromEnd, endFromDur].filter((value): value is number => value !== null).reduce<number | null>((left, value) => left === null ? value : Math.min(left, value), null);
  if (begin !== null && end !== null && begin > end) throw new Error('TTML end precedes begin');
  if (parentEnd !== null && ((begin !== null && begin > parentEnd) || (end !== null && end > parentEnd))) throw new Error('TTML child time exceeds parent');
  return [begin, end];
}

function textOnly(node: Element, label: string): string {
  if (Array.from(node.childNodes).some((child) => child.nodeType !== Node.TEXT_NODE && child.nodeType !== Node.CDATA_SECTION_NODE)) throw new Error(`${label} contains unsupported structure`);
  return node.textContent ?? '';
}

function checkAttributes(node: Element, allowed: string[]) {
  for (const attribute of Array.from(node.attributes)) {
    if (attribute.namespaceURI === 'http://www.w3.org/2000/xmlns/') continue;
    if (attribute.namespaceURI === null && allowed.includes(attribute.localName)) continue;
    if (attribute.namespaceURI === XML && ['id', 'lang'].includes(attribute.localName)) continue;
    if (attribute.namespaceURI === TTS && attribute.localName === 'ruby') continue;
    if (attribute.namespaceURI === TTM && attribute.localName === 'agent') continue;
    if (attribute.namespaceURI === STUDIO && ['id', 'null'].includes(attribute.localName)) continue;
    throw new Error(`Unsupported TTML attribute ${attribute.name} on <${node.localName}>`);
  }
}

function makeWord(node: Node, lineId: string, index: number, lineStart: number, lineEnd: TimeUs): LyricWord | null {
  const id = `${lineId}:word:${index}`;
  if (node.nodeType === Node.TEXT_NODE || node.nodeType === Node.CDATA_SECTION_NODE) {
    const text = node.nodeValue ?? '';
    return text ? createWord(text, id) : null;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) throw new Error('Unsupported TTML line child');
  const element = node as Element;
  if (!is(element, TTML, 'span')) throw new Error(`Unsupported TTML line child <${element.localName}>`);
  checkAttributes(element, ['begin', 'end', 'dur']);
  const wordId = attr(element, STUDIO, 'id') ?? id;
  const [beginUs, endUs] = boundaries(element, lineStart, lineEnd);
  const rubyKind = attr(element, TTS, 'ruby');
  if (!rubyKind) {
    const text = textOnly(element, 'Word');
    return text ? { ...createWord(text, wordId), beginUs, endUs } : null;
  }
  if (rubyKind !== 'container') throw new Error(`Unsupported Ruby type: ${rubyKind}`);
  const parts = Array.from(element.children);
  if (parts.length !== 2 || parts.some((part) => !is(part, TTML, 'span'))) throw new Error('Ruby container requires one base and one reading span');
  const base = parts.find((part) => attr(part, TTS, 'ruby') === 'base');
  const reading = parts.find((part) => attr(part, TTS, 'ruby') === 'text');
  if (!base || !reading) throw new Error('Ruby container requires base and text spans');
  checkAttributes(base, []);
  checkAttributes(reading, []);
  const text = textOnly(base, 'Ruby base');
  if (!text) throw new Error('Ruby base must be non-empty');
  const rubyUnits: RubyUnit[] = [];
  let unitIndex = 0;
  for (const child of Array.from(reading.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE || child.nodeType === Node.CDATA_SECTION_NODE) {
      const value = child.nodeValue ?? '';
      if (value) rubyUnits.push({ id: `${wordId}:ruby:${unitIndex++}`, reading: value, beginUs: null, endUs: null });
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE || !is(child as Element, TTML, 'span')) throw new Error('Unsupported Ruby reading child');
    const part = child as Element;
    checkAttributes(part, ['begin', 'end', 'dur']);
    const value = textOnly(part, 'Ruby reading unit');
    if (!value) throw new Error('Ruby reading unit must be non-empty');
    const [unitBegin, unitEnd] = boundaries(part, lineStart, lineEnd);
    rubyUnits.push({ id: attr(part, STUDIO, 'id') ?? `${wordId}:ruby:${unitIndex}`, reading: value, beginUs: unitBegin, endUs: unitEnd });
    unitIndex++;
  }
  if (!rubyUnits.length) throw new Error('Ruby reading must be non-empty');
  return { ...createWord(text, wordId), beginUs, endUs, rubyUnits };
}

export function parseLyricTtml(xml: string): LyricDocument {
  if (new TextEncoder().encode(xml).byteLength > MAX_BYTES) throw new Error('TTML exceeds 2 MiB limit');
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml)) throw new Error('DTD and external entities are not accepted');
  const parsed = new DOMParser().parseFromString(xml, 'application/xml');
  if (parsed.querySelector('parsererror')) throw new Error('Invalid TTML XML');
  const root = parsed.documentElement;
  if (!is(root, TTML, 'tt')) throw new Error('Root must be TTML tt');
  checkAttributes(root, ['begin', 'end']);
  const agents: LyricAgent[] = [];
  const metadata: Record<string, string[]> = {};
  const lines: LyricLine[] = [];
  const rootStart = attr(root, null, 'begin') === null ? 0 : parseTime(attr(root, null, 'begin')!);
  const head = Array.from(root.children).find((child) => is(child, TTML, 'head'));
  if (head) {
    checkAttributes(head, []);
    for (const child of Array.from(head.children)) {
      if (is(child, TTM, 'agent')) {
        checkAttributes(child, ['type']);
        const id = attr(child, XML, 'id');
        if (!id) throw new Error('Agent needs xml:id');
        const nameNode = Array.from(child.children).find((item) => is(item, TTM, 'name'));
        if (Array.from(child.children).some((item) => item !== nameNode)) throw new Error('Unsupported agent structure');
        agents.push({ id, name: nameNode ? textOnly(nameNode, 'Agent name') : null, type: attr(child, null, 'type') });
      } else if (is(child, TTML, 'metadata')) {
        for (const entry of Array.from(child.children)) {
          if (entry.namespaceURI !== TTM) throw new Error(`Unsupported metadata <${entry.localName}>`);
          checkAttributes(entry, []);
          (metadata[entry.localName] ??= []).push(textOnly(entry, 'Metadata'));
        }
      } else throw new Error(`Unsupported TTML head child <${child.localName}>`);
    }
  }
  const body = Array.from(root.children).find((child) => is(child, TTML, 'body'));
  if (!body || Array.from(root.children).some((child) => child !== head && child !== body)) throw new Error('TTML requires one body and supported head content');
  const visit = (parent: Element, parentStart: number, parentEnd: TimeUs, depth: number) => {
    if (depth > 128) throw new Error('TTML nesting exceeds depth 128');
    checkAttributes(parent, ['begin', 'end', 'dur', 'timeContainer']);
    const [ownBegin, ownEnd] = boundaries(parent, parentStart, parentEnd);
    const start = ownBegin ?? parentStart;
    for (const child of Array.from(parent.children)) {
      if (is(child, TTML, 'div')) {
        visit(child, start, ownEnd, depth + 1);
        continue;
      }
      if (!is(child, TTML, 'p')) throw new Error(`Unsupported TTML body child <${child.localName}>`);
      checkAttributes(child, ['begin', 'end', 'dur']);
      const [beginUs, endUs] = boundaries(child, start, ownEnd);
      const id = attr(child, XML, 'id') ?? `line-${lines.length + 1}`;
      const wordStart = beginUs ?? start;
      const words = Array.from(child.childNodes).map((node, index) => makeWord(node, id, index, wordStart, endUs)).filter((word): word is LyricWord => word !== null);
      const agentRefs = (attr(child, TTM, 'agent') ?? '').split(/\s+/).filter(Boolean);
      if (agentRefs.some((ref) => !agents.some((agent) => agent.id === ref))) throw new Error(`Unknown agent on line ${id}`);
      lines.push({ id, words, beginUs, endUs, agentRefs, backgroundOf: null, duet: false, translations: [], romanizations: [], ignoreSync: false });
    }
  };
  visit(body, rootStart, null, 1);
  if (new Set(lines.map((line) => line.id)).size !== lines.length) throw new Error('Duplicate line id');
  return { schemaVersion: LYRIC_SCHEMA_VERSION, lines, agents, metadata, language: attr(root, XML, 'lang') };
}

function setTime(node: Element, begin: TimeUs, end: TimeUs, parentStart: number, draft: boolean) {
  if (begin !== null) node.setAttribute('begin', timeText(begin - parentStart));
  if (end !== null) node.setAttribute('end', timeText(end - parentStart));
  if (draft) {
    const nulls = [begin === null ? 'begin' : '', end === null ? 'end' : ''].filter(Boolean);
    if (nulls.length) node.setAttributeNS(STUDIO, 'studio:null', nulls.join(' '));
  }
}

export function serializeLyricTtml(document: LyricDocument, options: { draft?: boolean } = {}): string {
  if (document.schemaVersion !== LYRIC_SCHEMA_VERSION) throw new Error('Unsupported lyric document schema');
  const draft = options.draft === true;
  const xml = new DOMParser().parseFromString(`<tt xmlns="${TTML}" xmlns:tts="${TTS}" xmlns:ttm="${TTM}"${draft ? ` xmlns:studio="${STUDIO}"` : ''}><body/></tt>`, 'application/xml');
  const root = xml.documentElement;
  if (document.language) root.setAttributeNS(XML, 'xml:lang', document.language);
  if (document.agents.length || Object.keys(document.metadata).length) {
    const head = xml.createElementNS(TTML, 'head');
    const metadataNode = xml.createElementNS(TTML, 'metadata');
    for (const [key, values] of Object.entries(document.metadata)) for (const value of values) {
      if (!/^[A-Za-z][\w.-]*$/.test(key)) throw new Error(`Invalid metadata name: ${key}`);
      const entry = xml.createElementNS(TTM, `ttm:${key}`);
      entry.textContent = value;
      metadataNode.appendChild(entry);
    }
    if (metadataNode.childNodes.length) head.appendChild(metadataNode);
    for (const agent of document.agents) {
      const entry = xml.createElementNS(TTM, 'ttm:agent');
      entry.setAttributeNS(XML, 'xml:id', agent.id);
      if (agent.type) entry.setAttribute('type', agent.type);
      if (agent.name !== null) {
        const name = xml.createElementNS(TTM, 'ttm:name');
        name.textContent = agent.name;
        entry.appendChild(name);
      }
      head.appendChild(entry);
    }
    root.insertBefore(head, root.firstChild);
  }
  const body = Array.from(root.children).find((child) => is(child, TTML, 'body'))!;
  for (const line of document.lines) {
    if (line.backgroundOf || line.duet || line.translations.length || line.romanizations.length || line.ignoreSync) throw new Error(`Line ${line.id} has fields not yet mapped to TTML`);
    const p = xml.createElementNS(TTML, 'p');
    p.setAttributeNS(XML, 'xml:id', line.id);
    setTime(p, line.beginUs, line.endUs, 0, draft);
    if (line.agentRefs.length) p.setAttributeNS(TTM, 'ttm:agent', line.agentRefs.join(' '));
    const lineStart = line.beginUs ?? 0;
    for (const word of line.words) {
      if (word.romanization || word.obscene || word.emptyBeat) throw new Error(`Word ${word.id} has fields not yet mapped to TTML`);
      const span = xml.createElementNS(TTML, 'span');
      if (draft) span.setAttributeNS(STUDIO, 'studio:id', word.id);
      setTime(span, word.beginUs, word.endUs, lineStart, draft);
      if (!word.rubyUnits.length) span.textContent = word.text;
      else {
        span.setAttributeNS(TTS, 'tts:ruby', 'container');
        const base = xml.createElementNS(TTML, 'span');
        base.setAttributeNS(TTS, 'tts:ruby', 'base');
        base.textContent = word.text;
        span.appendChild(base);
        const reading = xml.createElementNS(TTML, 'span');
        reading.setAttributeNS(TTS, 'tts:ruby', 'text');
        for (const unit of word.rubyUnits) {
          const part = xml.createElementNS(TTML, 'span');
          if (draft) part.setAttributeNS(STUDIO, 'studio:id', unit.id);
          setTime(part, unit.beginUs, unit.endUs, lineStart, draft);
          part.textContent = unit.reading;
          reading.appendChild(part);
        }
        span.appendChild(reading);
      }
      p.appendChild(span);
    }
    body.appendChild(p);
  }
  return new XMLSerializer().serializeToString(xml);
}
