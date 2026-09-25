import { createWord, LYRIC_SCHEMA_VERSION, type LyricAgent, type LyricDocument, type LyricLine, type LyricWord, type RubyUnit, type TimeUs } from '../../domain/lyric-document';

const TTML = 'http://www.w3.org/ns/ttml';
const TTS = 'http://www.w3.org/ns/ttml#styling';
const TTM = 'http://www.w3.org/ns/ttml#metadata';
const XML = 'http://www.w3.org/XML/1998/namespace';
const STUDIO = 'urn:lazulite:studio:draft';
const ITUNES = 'http://music.apple.com/lyric-ttml-internal';
const AMLL = 'http://www.example.com/ns/amll';
const MAX_BYTES = 2 * 1024 * 1024;

const attr = (node: Element, ns: string | null, name: string) => node.getAttributeNS(ns, name);
const is = (node: Element, ns: string, name: string) => node.namespaceURI === ns && node.localName === name;

function parseTime(value: string): number {
  const raw = value.trim();
  let seconds: number;
  if (/^\d+(?:\.\d+)?$/.test(raw)) seconds = Number(raw);
  else if (/^\d+(?:\.\d+)?ms$/.test(raw)) seconds = Number(raw.slice(0, -2)) / 1000;
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
  return (us / 1_000_000).toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
}

function boundaries(node: Element, parentStart: number, parentEnd: TimeUs): [TimeUs, TimeUs] {
  if (attr(node, null, 'timeContainer') === 'seq') throw new Error('Sequential TTML timing is not supported');
  const beginRaw = attr(node, null, 'begin');
  const endRaw = attr(node, null, 'end');
  const durRaw = attr(node, null, 'dur');
  const nulls = (attr(node, STUDIO, 'null') ?? '').split(/\s+/);
  // Reference-tool numeric clock values are absolute media seconds. Unit-bearing
  // TTML offsets retain their relative timing semantics.
  const value = (raw: string) => /^\d+(?:\.\d+)?$/.test(raw.trim()) ? parseTime(raw) : parentStart + parseTime(raw);
  const begin = nulls.includes('begin') ? null : beginRaw === null ? null : value(beginRaw);
  const endFromEnd = endRaw === null ? null : value(endRaw);
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
    if (attribute.namespaceURI === TTM && attribute.localName === 'role') continue;
    if (attribute.namespaceURI === ITUNES && ['key', 'timing', 'songPart'].includes(attribute.localName)) continue;
    if (attribute.namespaceURI === STUDIO && ['id', 'null'].includes(attribute.localName)) continue;
    throw new Error(`Unsupported TTML attribute ${attribute.name} on <${node.localName}>`);
  }
}

function makeWord(node: Node, lineId: string, index: number, lineStart: number, lineEnd: TimeUs): LyricWord | null {
  const id = `${lineId}:word:${index}`;
  if (node.nodeType === Node.TEXT_NODE || node.nodeType === Node.CDATA_SECTION_NODE) {
    const text = node.nodeValue ?? '';
    if (!text.trim() && /[\r\n]/.test(text)) return null;
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
  const reading = parts.find((part) => ['text', 'textContainer'].includes(attr(part, TTS, 'ruby') ?? ''));
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
      if (!value.trim() && /[\r\n]/.test(value)) continue;
      if (value) rubyUnits.push({ id: `${wordId}:ruby:${unitIndex++}`, reading: value, beginUs: null, endUs: null });
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE || !is(child as Element, TTML, 'span')) throw new Error('Unsupported Ruby reading child');
    const part = child as Element;
    checkAttributes(part, ['begin', 'end', 'dur']);
    if (attr(reading, TTS, 'ruby') === 'textContainer' && attr(part, TTS, 'ruby') !== 'text') throw new Error('Ruby textContainer requires text spans');
    const value = textOnly(part, 'Ruby reading unit');
    if (!value) throw new Error('Ruby reading unit must be non-empty');
    const [unitBegin, unitEnd] = boundaries(part, lineStart, lineEnd);
    rubyUnits.push({ id: attr(part, STUDIO, 'id') ?? `${wordId}:ruby:${unitIndex}`, reading: value, beginUs: unitBegin, endUs: unitEnd });
    unitIndex++;
  }
  if (!rubyUnits.length) throw new Error('Ruby reading must be non-empty');
  return {
    ...createWord(text, wordId),
    beginUs: beginUs ?? (rubyUnits.every((unit) => unit.beginUs !== null) ? Math.min(...rubyUnits.map((unit) => unit.beginUs!)) : null),
    endUs: endUs ?? (rubyUnits.every((unit) => unit.endUs !== null) ? Math.max(...rubyUnits.map((unit) => unit.endUs!)) : null),
    rubyUnits,
  };
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
  const metadata: Record<string, string[]> = Object.create(null);
  const lines: LyricLine[] = [];
  const appleSubLyrics = new Map<string, { translations: LyricLine['translations']; romanizations: LyricLine['romanizations'] }>();
  const addMetadata = (key: string, value: string) => { (metadata[key] ??= []).push(value); };
  const readAppleMetadata = (node: Element) => {
    checkAttributes(node, []);
    for (const group of Array.from(node.children)) {
      if (!is(group, ITUNES, 'songwriters') && !is(group, ITUNES, 'translations') && !is(group, ITUNES, 'transliterations')) throw new Error(`Unsupported iTunes metadata <${group.localName}>`);
      checkAttributes(group, []);
      for (const entry of Array.from(group.children)) {
        if (is(group, ITUNES, 'songwriters')) {
          if (!is(entry, ITUNES, 'songwriter')) throw new Error(`Unsupported songwriter <${entry.localName}>`);
          checkAttributes(entry, []);
          addMetadata('songwriter', textOnly(entry, 'Songwriter'));
          continue;
        }
        const translation = is(group, ITUNES, 'translations');
        if (!is(entry, ITUNES, translation ? 'translation' : 'transliteration')) throw new Error(`Unsupported iTunes sublyric <${entry.localName}>`);
        checkAttributes(entry, []);
        for (const item of Array.from(entry.children)) {
          if (!is(item, ITUNES, 'text')) throw new Error(`Unsupported iTunes sublyric child <${item.localName}>`);
          checkAttributes(item, ['for']);
          const lineId = attr(item, null, 'for');
          if (!lineId) throw new Error('iTunes sublyric needs a line reference');
          const target = appleSubLyrics.get(lineId) ?? { translations: [], romanizations: [] };
          target[translation ? 'translations' : 'romanizations'].push({ language: attr(entry, XML, 'lang'), text: textOnly(item, 'iTunes sublyric') });
          appleSubLyrics.set(lineId, target);
        }
      }
    }
  };
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
          if (is(entry, TTM, 'agent')) {
            checkAttributes(entry, ['type']);
            const id = attr(entry, XML, 'id');
            if (!id) throw new Error('Agent needs xml:id');
            const name = Array.from(entry.children).find((item) => is(item, TTM, 'name'));
            if (Array.from(entry.children).some((item) => item !== name)) throw new Error('Unsupported agent structure');
            agents.push({ id, name: name ? textOnly(name, 'Agent name') : null, type: attr(entry, null, 'type') });
            continue;
          }
          if (is(entry, AMLL, 'meta')) {
            checkAttributes(entry, ['key', 'value']);
            const key = attr(entry, null, 'key');
            const value = attr(entry, null, 'value');
            if (!key || value === null) throw new Error('AMLL metadata needs key and value');
            addMetadata(key === 'musicName' ? 'title' : key === 'artists' ? 'artist' : key, value);
            continue;
          }
          if (is(entry, ITUNES, 'iTunesMetadata')) { readAppleMetadata(entry); continue; }
          if (entry.namespaceURI !== TTM) throw new Error(`Unsupported metadata <${entry.localName}>`);
          checkAttributes(entry, []);
          addMetadata(entry.localName, textOnly(entry, 'Metadata'));
        }
      } else throw new Error(`Unsupported TTML head child <${child.localName}>`);
    }
  }
  const body = Array.from(root.children).find((child) => is(child, TTML, 'body'));
  if (!body || Array.from(root.children).some((child) => child !== head && child !== body)) throw new Error('TTML requires one body and supported head content');
  const visit = (parent: Element, parentStart: number, parentEnd: TimeUs, depth: number, songPart: string | null) => {
    if (depth > 128) throw new Error('TTML nesting exceeds depth 128');
    checkAttributes(parent, ['begin', 'end', 'dur', 'timeContainer']);
    const [ownBegin, ownEnd] = boundaries(parent, parentStart, parentEnd);
    const start = ownBegin ?? parentStart;
    const part = attr(parent, ITUNES, 'songPart') ?? songPart;
    for (const child of Array.from(parent.children)) {
      if (is(child, TTML, 'div')) {
        visit(child, start, ownEnd, depth + 1, part);
        continue;
      }
      if (!is(child, TTML, 'p')) throw new Error(`Unsupported TTML body child <${child.localName}>`);
      checkAttributes(child, ['begin', 'end', 'dur']);
      const [beginUs, endUs] = boundaries(child, start, ownEnd);
      const id = attr(child, XML, 'id') ?? attr(child, ITUNES, 'key') ?? `line-${lines.length + 1}`;
      const wordStart = beginUs ?? start;
      const translations: LyricLine['translations'] = [];
      const romanizations: LyricLine['romanizations'] = [];
      let background: Element | null = null;
      const words: LyricWord[] = [];
      for (const [index, node] of Array.from(child.childNodes).entries()) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          const role = attr(node as Element, TTM, 'role');
          if (role === 'x-translation' || role === 'x-roman') {
            checkAttributes(node as Element, []);
            const value = { language: attr(node as Element, XML, 'lang'), text: textOnly(node as Element, role) };
            (role === 'x-translation' ? translations : romanizations).push(value);
            continue;
          }
          if (role === 'x-bg') {
            if (background) throw new Error(`Line ${id} has multiple background vocals`);
            background = node as Element;
            continue;
          }
          if (role) throw new Error(`Unsupported TTML role ${role}`);
        }
        const word = makeWord(node, id, index, wordStart, endUs);
        if (word) words.push(word);
      }
      const agentRefs = (attr(child, TTM, 'agent') ?? '').split(/\s+/).filter(Boolean);
      if (agentRefs.some((ref) => !agents.some((agent) => agent.id === ref))) throw new Error(`Unknown agent on line ${id}`);
      lines.push({ id, words, beginUs, endUs, agentRefs, backgroundOf: null, songPart: part, duet: false, translations, romanizations, ignoreSync: false });
      if (background) {
        checkAttributes(background, ['begin', 'end', 'dur']);
        const [bgBegin, bgEnd] = boundaries(background, wordStart, endUs);
        const bgId = `${id}:bg`;
        const bgStart = bgBegin ?? wordStart;
        const bgWords = Array.from(background.childNodes).map((node, index) => makeWord(node, bgId, index, bgStart, bgEnd)).filter((word): word is LyricWord => word !== null);
        if (bgWords.length) {
          bgWords[0] = { ...bgWords[0], text: bgWords[0].text.replace(/^\(/, '') };
          const last = bgWords.length - 1;
          bgWords[last] = { ...bgWords[last], text: bgWords[last].text.replace(/\)$/, '') };
        }
        lines.push({ id: bgId, words: bgWords, beginUs: bgBegin ?? (bgWords.every((word) => word.beginUs !== null) && bgWords.length ? Math.min(...bgWords.map((word) => word.beginUs!)) : null), endUs: bgEnd ?? (bgWords.every((word) => word.endUs !== null) && bgWords.length ? Math.max(...bgWords.map((word) => word.endUs!)) : null), agentRefs, backgroundOf: id, songPart: part, duet: false, translations: [], romanizations: [], ignoreSync: false });
      }
    }
  };
  visit(body, rootStart, null, 1, null);
  if (new Set(lines.map((line) => line.id)).size !== lines.length) throw new Error('Duplicate line id');
  for (const [id, content] of appleSubLyrics) {
    const line = lines.find((item) => item.id === id && !item.backgroundOf);
    if (!line) throw new Error(`iTunes sublyric refers to unknown line ${id}`);
    line.translations.push(...content.translations);
    line.romanizations.push(...content.romanizations);
  }
  return { schemaVersion: LYRIC_SCHEMA_VERSION, lines, agents, metadata, language: attr(root, XML, 'lang') };
}

function setTime(node: Element, begin: TimeUs, end: TimeUs, draft: boolean) {
  if (begin !== null) node.setAttribute('begin', timeText(begin));
  if (end !== null) node.setAttribute('end', timeText(end));
  if (draft) {
    const nulls = [begin === null ? 'begin' : '', end === null ? 'end' : ''].filter(Boolean);
    if (nulls.length) node.setAttributeNS(STUDIO, 'studio:null', nulls.join(' '));
  }
}

export function serializeLyricTtml(document: LyricDocument, options: { draft?: boolean } = {}): string {
  if (document.schemaVersion !== LYRIC_SCHEMA_VERSION) throw new Error('Unsupported lyric document schema');
  const draft = options.draft === true;
  const xml = new DOMParser().parseFromString(`<tt xmlns="${TTML}" xmlns:tts="${TTS}" xmlns:ttm="${TTM}" xmlns:itunes="${ITUNES}" xmlns:amll="${AMLL}"${draft ? ` xmlns:studio="${STUDIO}"` : ''}><body/></tt>`, 'application/xml');
  const root = xml.documentElement;
  if (document.language) root.setAttributeNS(XML, 'xml:lang', document.language);
  if (document.agents.length || Object.keys(document.metadata).length) {
    const head = xml.createElementNS(TTML, 'head');
    const metadataNode = xml.createElementNS(TTML, 'metadata');
    const songwriters = document.metadata.songwriter ?? [];
    for (const [key, values] of Object.entries(document.metadata)) for (const value of values) {
      if (!/^[A-Za-z][\w.-]*$/.test(key)) throw new Error(`Invalid metadata name: ${key}`);
      if (key === 'songwriter') continue;
      const entry = xml.createElementNS(AMLL, 'amll:meta');
      entry.setAttribute('key', key === 'title' ? 'musicName' : key === 'artist' ? 'artists' : key);
      entry.setAttribute('value', value);
      metadataNode.appendChild(entry);
    }
    if (songwriters.length) {
      const itunes = xml.createElementNS(ITUNES, 'itunes:iTunesMetadata');
      const group = xml.createElementNS(ITUNES, 'itunes:songwriters');
      for (const value of songwriters) {
        const writer = xml.createElementNS(ITUNES, 'itunes:songwriter');
        writer.textContent = value;
        group.appendChild(writer);
      }
      itunes.appendChild(group);
      metadataNode.appendChild(itunes);
    }
    for (const agent of document.agents) {
      const entry = xml.createElementNS(TTM, 'ttm:agent');
      entry.setAttributeNS(XML, 'xml:id', agent.id);
      if (agent.type) entry.setAttribute('type', agent.type);
      if (agent.name !== null) {
        const name = xml.createElementNS(TTM, 'ttm:name');
        name.textContent = agent.name;
        entry.appendChild(name);
      }
      metadataNode.appendChild(entry);
    }
    head.appendChild(metadataNode);
    root.insertBefore(head, root.firstChild);
  }
  const body = Array.from(root.children).find((child) => is(child, TTML, 'body'))!;
  const mainLines = document.lines.filter((line) => !line.backgroundOf);
  const lineEnds = mainLines.map((line) => line.endUs).filter((value): value is number => value !== null);
  if (lineEnds.length) {
    body.setAttribute('dur', timeText(Math.max(...lineEnds)));
  }
  let div: Element | null = null;
  let currentPart: string | null | undefined;
  const backgrounds = new Map<string, LyricLine>();
  for (const line of document.lines) if (line.backgroundOf) {
    if (backgrounds.has(line.backgroundOf)) throw new Error(`Multiple background vocals for ${line.backgroundOf}`);
    backgrounds.set(line.backgroundOf, line);
  }
  for (const parentId of backgrounds.keys()) if (!document.lines.some((line) => line.id === parentId && !line.backgroundOf)) throw new Error(`Background vocal has no parent: ${parentId}`);
  for (const line of document.lines) {
    if (line.backgroundOf) continue;
    if (line.duet || line.ignoreSync) throw new Error(`Line ${line.id} has fields not yet mapped to TTML`);
    if (!div || currentPart !== line.songPart) {
      currentPart = line.songPart;
      div = xml.createElementNS(TTML, 'div');
      if (currentPart) div.setAttributeNS(ITUNES, 'itunes:songPart', currentPart);
      body.appendChild(div);
    }
    const p = xml.createElementNS(TTML, 'p');
    p.setAttributeNS(XML, 'xml:id', line.id);
    p.setAttributeNS(ITUNES, 'itunes:key', line.id);
    setTime(p, line.beginUs, line.endUs, draft);
    if (line.agentRefs.length) p.setAttributeNS(TTM, 'ttm:agent', line.agentRefs.join(' '));
    const appendWord = (parent: Element, word: LyricWord, text: string) => {
      if (word.romanization || word.obscene || word.emptyBeat) throw new Error(`Word ${word.id} has fields not yet mapped to TTML`);
      const span = xml.createElementNS(TTML, 'span');
      if (draft) span.setAttributeNS(STUDIO, 'studio:id', word.id);
      setTime(span, word.beginUs, word.endUs, draft);
      if (!word.rubyUnits.length) span.textContent = text;
      else {
        span.setAttributeNS(TTS, 'tts:ruby', 'container');
        const base = xml.createElementNS(TTML, 'span');
        base.setAttributeNS(TTS, 'tts:ruby', 'base');
        base.textContent = text;
        span.appendChild(base);
        const reading = xml.createElementNS(TTML, 'span');
        reading.setAttributeNS(TTS, 'tts:ruby', 'textContainer');
        for (const unit of word.rubyUnits) {
          const part = xml.createElementNS(TTML, 'span');
          part.setAttributeNS(TTS, 'tts:ruby', 'text');
          if (draft) part.setAttributeNS(STUDIO, 'studio:id', unit.id);
          setTime(part, unit.beginUs, unit.endUs, draft);
          part.textContent = unit.reading;
          reading.appendChild(part);
        }
        span.appendChild(reading);
      }
      parent.appendChild(span);
    };
    for (const word of line.words) appendWord(p, word, word.text);
    for (const [role, items] of [['x-translation', line.translations], ['x-roman', line.romanizations]] as const) for (const item of items) {
      const span = xml.createElementNS(TTML, 'span');
      span.setAttributeNS(TTM, 'ttm:role', role);
      if (item.language) span.setAttributeNS(XML, 'xml:lang', item.language);
      span.textContent = item.text;
      p.appendChild(span);
    }
    const bg = backgrounds.get(line.id);
    if (bg) {
      if (bg.duet || bg.ignoreSync || bg.translations.length || bg.romanizations.length) throw new Error(`Background vocal ${bg.id} has fields not yet mapped to TTML`);
      const span = xml.createElementNS(TTML, 'span');
      span.setAttributeNS(TTM, 'ttm:role', 'x-bg');
      setTime(span, bg.beginUs, bg.endUs, draft);
      bg.words.forEach((word, index) => appendWord(span, word, `${index === 0 ? '(' : ''}${word.text}${index === bg.words.length - 1 ? ')' : ''}`));
      p.appendChild(span);
    }
    div.appendChild(p);
  }
  return new XMLSerializer().serializeToString(xml);
}
