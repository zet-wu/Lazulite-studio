import { nonemptyTranslations } from '../../domain/sublyrics';
import { createWord, LYRIC_SCHEMA_VERSION, type LyricAgent, type LyricDocument, type LyricLine, type LyricWord, type RomanizationTrack, type RomanizationUnit, type RubyUnit, type TimeMs } from '../../domain/lyric-document';

const TTML = 'http://www.w3.org/ns/ttml';
const TTS = 'http://www.w3.org/ns/ttml#styling';
const TTM = 'http://www.w3.org/ns/ttml#metadata';
const XML = 'http://www.w3.org/XML/1998/namespace';
const STUDIO = 'urn:lazulite:studio:draft';
const ITUNES = 'http://music.apple.com/lyric-ttml-internal';
const AMLL = 'http://www.example.com/ns/amll';
const MAX_BYTES = 2 * 1024 * 1024;

const attr = (node: Element, ns: string | null, name: string) => node.getAttributeNS(ns, name);
const is = (node: Element, ns: string, name: string) => (node.namespaceURI === ns || ns === TTML && node.namespaceURI === null) && node.localName === name;

function readAgent(node: Element): LyricAgent {
  const id = attr(node, XML, 'id');
  if (!id) throw new Error('歌手缺少 xml:id');
  const strict = (element: Element, allowed: string[]) => {
    for (const a of Array.from(element.attributes)) {
      if (a.namespaceURI === 'http://www.w3.org/2000/xmlns/') continue;
      if (allowed.includes(a.namespaceURI ? `{${a.namespaceURI}}${a.localName}` : a.localName)) continue;
      throw new Error(`歌手 ${id} 的 ${element.localName} 包含不支持的属性 ${a.name}`);
    }
  };
  strict(node, ['type', `{${XML}}id`]);
  let name: string | null = null, actorRef: string | undefined;
  for (const child of Array.from(node.children)) {
    if (is(child, TTM, 'name') && name === null) { strict(child, []); name = textOnly(child, `歌手 ${id} 的 name`); }
    else if (is(child, TTM, 'actor') && actorRef === undefined) {
      strict(child, ['agent']);
      actorRef = attr(child, null, 'agent') ?? '';
      if (!/^[A-Za-z_][\w.-]*$/.test(actorRef) || child.children.length || child.textContent?.trim()) throw new Error(`歌手 ${id} 的 actor 需要单个 agent 引用且不支持子结构`);
    } else throw new Error(`歌手 ${id} 包含不支持的结构或重复的 ${child.localName}`);
  }
  return { id, name, type: attr(node, null, 'type'), ...(actorRef === undefined ? {} : { actorRef }) };
}

function parseTime(value: string): number {
  const raw = value.trim();
  const decimalMs = (text: string) => {
    const [whole, fraction = ''] = text.split('.');
    return Number(whole) * 1000 + Number((fraction + '000').slice(0, 3)) + Number(`0.${fraction.slice(3) || '0'}`);
  };
  let ms: number;
  if (/^\d+(?:\.\d+)?ms$/.test(raw)) ms = Number(raw.slice(0, -2));
  else if (/^\d+(?:\.\d+)?s?$/.test(raw)) ms = decimalMs(raw.replace(/s$/, ''));
  else {
    const match = /^(?:(\d+):)?(\d+):(\d{2}(?:\.\d+)?)$/.exec(raw);
    if (!match || Number(match[3]) >= 60 || match[1] !== undefined && Number(match[2]) >= 60) throw new Error(`Unsupported TTML time: ${value}`);
    ms = Number(match[1] ?? 0) * 3600000 + Number(match[2]) * 60000 + decimalMs(match[3]);
  }
  if (!Number.isSafeInteger(Math.round(ms))) throw new Error(`TTML time exceeds millisecond range: ${value}`);
  return ms;
}

function timeText(ms: number) {
  if (!Number.isSafeInteger(ms) || ms < 0) throw new Error('Invalid millisecond time');
  const seconds = Math.floor(ms / 1000);
  const tail = `${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;
  return seconds >= 3600 ? `${String(Math.floor(seconds / 3600)).padStart(2, '0')}:${tail}` : tail;
}

function boundaries(node: Element, parentStart: number, parentEnd: TimeMs, absoluteTimes: boolean): [TimeMs, TimeMs] {
  if (attr(node, null, 'timeContainer') === 'seq') throw new Error('Sequential TTML timing is not supported');
  const beginRaw = attr(node, null, 'begin');
  const endRaw = attr(node, null, 'end');
  const durRaw = attr(node, null, 'dur');
  const nulls = (attr(node, STUDIO, 'null') ?? '').split(/\s+/);
  // AMLL uses absolute media times; ordinary TTML offsets remain relative.
  const value = (raw: string) => absoluteTimes || /^\d+(?:\.\d+)?$/.test(raw.trim()) || /^\d+:\d{2}(?::\d{2})?(?:\.\d+)?$/.test(raw.trim())
    ? parseTime(raw) : parentStart + parseTime(raw);
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
    if (attribute.namespaceURI === XML && ['id', 'lang', 'space'].includes(attribute.localName)) continue;
    if (attribute.namespaceURI === TTS && attribute.localName === 'ruby') continue;
    if (attribute.namespaceURI === TTM && attribute.localName === 'agent') continue;
    if (attribute.namespaceURI === TTM && attribute.localName === 'role') continue;
    if (attribute.namespaceURI === ITUNES && ['key', 'timing', 'songPart'].includes(attribute.localName)) continue;
    if (attribute.namespaceURI === STUDIO && ['id', 'kind', 'null', 'endLink', 'emptyBeat', 'ignoreSync'].includes(attribute.localName)) continue;
    throw new Error(`Unsupported TTML attribute ${attribute.name} on <${node.localName}>`);
  }
}

function readEndLink(node: Element): LyricLine['endLink'] {
  const raw = attr(node, STUDIO, 'endLink');
  if (raw === null) return null;
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error('Invalid draft line end link'); }
  if (!value || typeof value !== 'object' || typeof (value as { targetLineId?: unknown }).targetLineId !== 'string') throw new Error('Invalid draft line end link');
  return { targetLineId: (value as { targetLineId: string }).targetLineId };
}

function makeWord(node: Node, lineId: string, index: number, lineStart: number, lineEnd: TimeMs, absoluteTimes: boolean): LyricWord | null {
  const id = `${lineId}:word:${index}`;
  if (node.nodeType === Node.TEXT_NODE || node.nodeType === Node.CDATA_SECTION_NODE) {
    const text = node.nodeValue ?? '';
    if (!text.trim() && /[\r\n]/.test(text) && (node.parentElement?.closest('[xml\\:space]')?.getAttributeNS(XML, 'space') !== 'preserve')) return null;
    return text ? createWord(text, id) : null;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) throw new Error('Unsupported TTML line child');
  const element = node as Element;
  if (!is(element, TTML, 'span')) throw new Error(`Unsupported TTML line child <${element.localName}>`);
  checkAttributes(element, ['begin', 'end', 'dur']);
  const wordId = attr(element, STUDIO, 'id') ?? id;
  const emptyBeat = Number(attr(element, STUDIO, 'emptyBeat') ?? 0);
  if (!Number.isSafeInteger(emptyBeat) || emptyBeat < 0 || emptyBeat > 32) throw new Error('Invalid draft empty beat count');
  const [beginMs, endMs] = boundaries(element, lineStart, lineEnd, absoluteTimes);
  const rubyKind = attr(element, TTS, 'ruby');
  if (!rubyKind) {
    const text = textOnly(element, 'Word');
    return text ? { ...createWord(text, wordId), beginMs, endMs, emptyBeat } : null;
  }
  if (rubyKind !== 'container') throw new Error(`不支持的注音类型： ${rubyKind}`);
  const parts = Array.from(element.children);
  if (parts.length !== 2 || parts.some((part) => !is(part, TTML, 'span'))) throw new Error('注音容器须包含一组正文和读音');
  const base = parts.find((part) => attr(part, TTS, 'ruby') === 'base');
  const reading = parts.find((part) => ['text', 'textContainer'].includes(attr(part, TTS, 'ruby') ?? ''));
  if (!base || !reading) throw new Error('注音容器缺少正文或读音');
  checkAttributes(base, []);
  checkAttributes(reading, []);
  const text = textOnly(base, '注音 base');
  if (!text) throw new Error('注音正文不能为空');
  const rubyUnits: RubyUnit[] = [];
  let unitIndex = 0;
  for (const child of Array.from(reading.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE || child.nodeType === Node.CDATA_SECTION_NODE) {
      const value = child.nodeValue ?? '';
      if (!value.trim() && /[\r\n]/.test(value)) continue;
      if (value) rubyUnits.push({ id: `${wordId}:ruby:${unitIndex++}`, reading: value, beginMs: null, endMs: null });
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE || !is(child as Element, TTML, 'span')) throw new Error('不支持的注音读音节点');
    const part = child as Element;
    checkAttributes(part, ['begin', 'end', 'dur']);
    if (attr(reading, TTS, 'ruby') === 'textContainer' && attr(part, TTS, 'ruby') !== 'text') throw new Error('注音读音容器须包含读音单元');
    const value = textOnly(part, '注音 reading unit');
    if (!value) throw new Error('注音读音单元不能为空');
    const [unitBegin, unitEnd] = boundaries(part, lineStart, lineEnd, absoluteTimes);
    rubyUnits.push({ id: attr(part, STUDIO, 'id') ?? `${wordId}:ruby:${unitIndex}`, reading: value, beginMs: unitBegin, endMs: unitEnd });
    unitIndex++;
  }
  if (!rubyUnits.length) throw new Error('注音读音不能为空');
  return {
    ...createWord(text, wordId),
    beginMs: beginMs ?? (rubyUnits.every((unit) => unit.beginMs !== null) ? Math.min(...rubyUnits.map((unit) => unit.beginMs!)) : null),
    endMs: endMs ?? (rubyUnits.every((unit) => unit.endMs !== null) ? Math.max(...rubyUnits.map((unit) => unit.endMs!)) : null),
    rubyUnits,
    emptyBeat,
  };
}

export function parseLyricTtml(xml: string): LyricDocument {
  if (new TextEncoder().encode(xml).byteLength > MAX_BYTES) throw new Error('TTML exceeds 2 MiB limit');
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml)) throw new Error('DTD and external entities are not accepted');
  const parsed = new DOMParser().parseFromString(xml, 'application/xml');
  if (parsed.querySelector('parsererror')) throw new Error('Invalid TTML XML');
  const root = parsed.documentElement;
  if (root.namespaceURI !== TTML || root.localName !== 'tt') throw new Error('Root must be TTML tt');
  checkAttributes(root, ['begin', 'end']);
  const absoluteTimes = attr(root, ITUNES, 'timing') !== null;
  const agents: LyricAgent[] = [];
  const metadata: Record<string, string[]> = Object.create(null);
  const lines: LyricLine[] = [];
  const appleTranslations = new Map<string, LyricLine['translations']>();
  const romanizationTracks: RomanizationTrack[] = [];
  const inlineRomanizationTracks = new Map<string, RomanizationTrack>();
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
        const track: RomanizationTrack | null = translation ? null : {
          id: attr(entry, STUDIO, 'id') ?? crypto.randomUUID(),
          language: attr(entry, XML, 'lang'), contents: [],
        };
        for (const item of Array.from(entry.children)) {
          if (!is(item, ITUNES, 'text')) throw new Error(`Unsupported iTunes sublyric child <${item.localName}>`);
          checkAttributes(item, ['for']);
          const lineId = attr(item, null, 'for');
          if (!lineId) throw new Error('iTunes sublyric needs a line reference');
          if (translation) {
            const values = appleTranslations.get(lineId) ?? [];
            values.push({ language: attr(entry, XML, 'lang'), text: textOnly(item, 'iTunes translation') });
            appleTranslations.set(lineId, values);
            continue;
          }
          const contentId = attr(item, STUDIO, 'id') ?? crypto.randomUUID();
          if (item.children.length || attr(item, STUDIO, 'kind') === 'timed') {
            const units: RomanizationUnit[] = [];
            let pending = '';
            for (const node of Array.from(item.childNodes)) {
              if (node.nodeType === Node.TEXT_NODE || node.nodeType === Node.CDATA_SECTION_NODE) {
                const value = node.nodeValue ?? '';
                if (value.trim() || !/[\r\n]/.test(value)) {
                  if (units.length) units[units.length - 1].text += value;
                  else pending += value;
                }
                continue;
              }
              if (node.nodeType !== Node.ELEMENT_NODE) throw new Error('Unsupported iTunes transliteration node');
              const span = node as Element;
              if (!is(span, ITUNES, 'span')) throw new Error(`Unsupported iTunes transliteration child <${span.localName}>`);
              checkAttributes(span, ['begin', 'end', 'dur']);
              const text = pending + textOnly(span, 'Word transliteration');
              pending = '';
              const [beginMs, endMs] = boundaries(span, 0, null, absoluteTimes);
              units.push({ id: attr(span, STUDIO, 'id') ?? crypto.randomUUID(), text, beginMs, endMs });
            }
            if (pending && units.length) units[units.length - 1].text += pending;
            track!.contents.push({ id: contentId, lineId, kind: 'timed', units });
          } else {
            track!.contents.push({ id: contentId, lineId, kind: 'plain', text: textOnly(item, 'iTunes transliteration') });
          }
        }
        if (track) romanizationTracks.push(track);
      }
    }
  };
  const rootStart = attr(root, null, 'begin') === null ? 0 : parseTime(attr(root, null, 'begin')!);
  const head = Array.from(root.children).find((child) => is(child, TTML, 'head'));
  if (head) {
    checkAttributes(head, []);
    for (const child of Array.from(head.children)) {
      if (is(child, TTM, 'agent')) {
        agents.push(readAgent(child));
      } else if (is(child, TTML, 'metadata')) {
        for (const entry of Array.from(child.children)) {
          if (is(entry, TTM, 'agent')) {
            agents.push(readAgent(entry));
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
  const visit = (parent: Element, parentStart: number, parentEnd: TimeMs, depth: number, songPart: string | null) => {
    if (depth > 128) throw new Error('TTML nesting exceeds depth 128');
    checkAttributes(parent, ['begin', 'end', 'dur', 'timeContainer']);
    const [ownBegin, ownEnd] = boundaries(parent, parentStart, parentEnd, absoluteTimes);
    const start = ownBegin ?? parentStart;
    const part = attr(parent, ITUNES, 'songPart') ?? songPart;
    for (const child of Array.from(parent.children)) {
      if (is(child, TTML, 'div')) {
        visit(child, start, ownEnd, depth + 1, part);
        continue;
      }
      if (!is(child, TTML, 'p')) throw new Error(`Unsupported TTML body child <${child.localName}>`);
      checkAttributes(child, ['begin', 'end', 'dur']);
      const [beginMs, endMs] = boundaries(child, start, ownEnd, absoluteTimes);
      const id = attr(child, XML, 'id') ?? attr(child, ITUNES, 'key') ?? `line-${lines.length + 1}`;
      const wordStart = beginMs ?? start;
      const translations: LyricLine['translations'] = [];
      const inlineRomanizations: Array<{ language: string | null; text: string }> = [];
      let background: Element | null = null;
      const words: LyricWord[] = [];
      for (const [index, node] of Array.from(child.childNodes).entries()) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          const role = attr(node as Element, TTM, 'role');
          if (role === 'x-translation' || role === 'x-roman') {
            checkAttributes(node as Element, []);
            const value = { language: attr(node as Element, XML, 'lang'), text: textOnly(node as Element, role) };
            (role === 'x-translation' ? translations : inlineRomanizations).push(value);
            continue;
          }
          if (role === 'x-bg') {
            if (background) throw new Error(`Line ${id} has multiple background vocals`);
            background = node as Element;
            continue;
          }
          if (role) throw new Error(`Unsupported TTML role ${role}`);
        }
        const word = makeWord(node, id, index, wordStart, endMs, absoluteTimes);
        if (word) words.push(word);
      }
      const agentRefs = (attr(child, TTM, 'agent') ?? '').split(/\s+/).filter(Boolean);
      if (agentRefs.some((ref) => !agents.some((agent) => agent.id === ref))) throw new Error(`Unknown agent on line ${id}`);
      const ignoreSync = attr(child, STUDIO, 'ignoreSync');
      if (ignoreSync !== null && ignoreSync !== 'true' && ignoreSync !== 'false') throw new Error('Invalid draft ignoreSync flag');
      lines.push({ id, words, beginMs, endMs, endLink: readEndLink(child), agentRefs, backgroundOf: null, songPart: part, translations, ignoreSync: ignoreSync === 'true' });
      inlineRomanizations.forEach((value, index) => {
        const key = `${value.language ?? ''}\u0000${index}`;
        let track = inlineRomanizationTracks.get(key);
        if (!track) {
          track = { id: crypto.randomUUID(), language: value.language, contents: [] };
          inlineRomanizationTracks.set(key, track);
        }
        track.contents.push({ id: crypto.randomUUID(), lineId: id, kind: 'plain', text: value.text });
      });
      if (background) {
        checkAttributes(background, ['begin', 'end', 'dur']);
        const [bgBegin, bgEnd] = boundaries(background, wordStart, ownEnd, absoluteTimes);
        const bgId = attr(background, STUDIO, 'id') ?? `${id}:bg`;
        const bgStart = bgBegin ?? wordStart;
        const bgWords = Array.from(background.childNodes).map((node, index) => makeWord(node, bgId, index, bgStart, bgEnd, absoluteTimes)).filter((word): word is LyricWord => word !== null);
        if (bgWords.length) {
          bgWords[0] = { ...bgWords[0], text: bgWords[0].text.replace(/^\(/, '') };
          const last = bgWords.length - 1;
          bgWords[last] = { ...bgWords[last], text: bgWords[last].text.replace(/\)$/, '') };
        }
        lines.push({ id: bgId, words: bgWords, beginMs: bgBegin ?? (bgWords.every((word) => word.beginMs !== null) && bgWords.length ? Math.min(...bgWords.map((word) => word.beginMs!)) : null), endMs: bgEnd ?? (bgWords.every((word) => word.endMs !== null) && bgWords.length ? Math.max(...bgWords.map((word) => word.endMs!)) : null), endLink: null, agentRefs: [], backgroundOf: id, songPart: null, translations: [], ignoreSync: false });
      }
    }
  };
  visit(body, rootStart, null, 1, null);
  if (new Set(lines.map((line) => line.id)).size !== lines.length) throw new Error('Duplicate line id');
  for (const line of lines) if (line.endLink) {
    const target = lines.find((item) => item.id === line.endLink!.targetLineId);
    if (!target || target.backgroundOf || target.beginMs === null || line.endMs !== target.beginMs) throw new Error(`Invalid draft end link on line ${line.id}`);
  }
  for (const [id, translations] of appleTranslations) {
    const line = lines.find((item) => item.id === id && !item.backgroundOf);
    if (!line) throw new Error(`iTunes sublyric refers to unknown line ${id}`);
    line.translations.push(...translations);
  }
  for (const line of lines) line.translations = nonemptyTranslations(line.translations);
  romanizationTracks.push(...inlineRomanizationTracks.values());
  for (const track of romanizationTracks) for (const content of track.contents) {
    if (!lines.some((line) => line.id === content.lineId && !line.backgroundOf)) throw new Error(`iTunes transliteration refers to unknown line ${content.lineId}`);
  }
  // Resolve all relative endpoints before quantizing; never round each ancestor.
  const quantize = (item: { beginMs: TimeMs; endMs: TimeMs }) => {
    if (item.beginMs !== null) item.beginMs = Math.floor(item.beginMs + 0.5 + Number.EPSILON * Math.max(1, item.beginMs));
    if (item.endMs !== null) item.endMs = Math.floor(item.endMs + 0.5 + Number.EPSILON * Math.max(1, item.endMs));
  };
  for (const line of lines) {
    quantize(line);
    for (const word of line.words) { quantize(word); word.rubyUnits.forEach(quantize); }
  }
  for (const track of romanizationTracks) for (const content of track.contents) if (content.kind === 'timed') content.units.forEach(quantize);
  for (const agent of agents) if (agent.actorRef && !agents.some(a => a.id === agent.actorRef)) throw new Error(`歌手 ${agent.id} 的 actor 引用不存在：${agent.actorRef}`);
  return { schemaVersion: LYRIC_SCHEMA_VERSION, lines, romanizationTracks, agents, metadata, language: attr(root, XML, 'lang') };
}

function setTime(node: Element, begin: TimeMs, end: TimeMs, draft: boolean) {
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
  const xml = new DOMParser().parseFromString(`<tt xmlns="${TTML}" xmlns:tts="${TTS}" xmlns:ttm="${TTM}" xmlns:amll="${AMLL}"${draft ? ` xmlns:studio="${STUDIO}"` : ''}><body/></tt>`, 'application/xml');
  const root = xml.documentElement;
  root.setAttributeNS(XML, 'xml:space', 'preserve');
  if (document.language) root.setAttributeNS(XML, 'xml:lang', document.language);
  if (document.agents.length || Object.keys(document.metadata).length || document.romanizationTracks.length) {
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
    const itunes = xml.createElementNS(ITUNES, 'iTunesMetadata');
    if (songwriters.length) {
      const group = xml.createElementNS(ITUNES, 'songwriters');
      for (const value of songwriters) {
        const writer = xml.createElementNS(ITUNES, 'songwriter');
        writer.textContent = value;
        group.appendChild(writer);
      }
      itunes.appendChild(group);
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
      if (agent.actorRef) { const actor = xml.createElementNS(TTM, 'ttm:actor'); actor.setAttribute('agent', agent.actorRef); entry.appendChild(actor); }
      metadataNode.appendChild(entry);
    }
    if (document.romanizationTracks.length) {
      const group = xml.createElementNS(ITUNES, 'transliterations');
      for (const track of document.romanizationTracks) {
        const entry = xml.createElementNS(ITUNES, 'transliteration');
        if (draft) entry.setAttributeNS(STUDIO, 'studio:id', track.id);
        if (track.language !== null) entry.setAttributeNS(XML, 'xml:lang', track.language);
        for (const content of track.contents) {
          if (!document.lines.some((line) => line.id === content.lineId && !line.backgroundOf)) throw new Error(`Transliteration refers to unknown line ${content.lineId}`);
          const textNode = xml.createElementNS(ITUNES, 'text');
          textNode.setAttribute('for', content.lineId);
          if (draft) {
            textNode.setAttributeNS(STUDIO, 'studio:id', content.id);
            if (content.kind === 'timed') textNode.setAttributeNS(STUDIO, 'studio:kind', 'timed');
          }
          if (content.kind === 'plain') textNode.textContent = content.text;
          else {
            if (!draft && !content.units.length) throw new Error(`Timed transliteration ${content.id} has no units`);
            for (const unit of content.units) {
              if (!draft && /^\s+$/.test(unit.text) && unit.beginMs === null && unit.endMs === null) {
                textNode.appendChild(xml.createTextNode(unit.text)); continue;
              }
              if (!draft && (unit.beginMs === null || unit.endMs === null)) throw new Error(`Transliteration unit ${unit.id} needs timing`);
              const span = xml.createElementNS(ITUNES, 'span');
              if (draft) span.setAttributeNS(STUDIO, 'studio:id', unit.id);
              setTime(span, unit.beginMs, unit.endMs, draft);
              span.textContent = unit.text;
              textNode.appendChild(span);
            }
          }
          entry.appendChild(textNode);
        }
        group.appendChild(entry);
      }
      itunes.appendChild(group);
    }
    if (itunes.childNodes.length) metadataNode.appendChild(itunes);
    head.appendChild(metadataNode);
    root.insertBefore(head, root.firstChild);
  }
  const body = Array.from(root.children).find((child) => is(child, TTML, 'body'))!;
  const lineEnds = document.lines.map((line) => line.endMs).filter((value): value is number => value !== null);
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
    if (!div || currentPart !== line.songPart) {
      currentPart = line.songPart;
      div = xml.createElementNS(TTML, 'div');
      if (currentPart) {
        div.setAttributeNS('http://www.w3.org/2000/xmlns/', 'xmlns:itunes', ITUNES);
        div.setAttributeNS(ITUNES, 'itunes:songPart', currentPart);
      }
      body.appendChild(div);
    }
    const p = xml.createElementNS(TTML, 'p');
    p.setAttributeNS('http://www.w3.org/2000/xmlns/', 'xmlns:itunes', ITUNES);
    p.setAttributeNS(XML, 'xml:id', line.id);
    p.setAttributeNS(ITUNES, 'itunes:key', line.id);
    setTime(p, line.beginMs, line.endMs, draft);
    if (draft && line.endLink) p.setAttributeNS(STUDIO, 'studio:endLink', JSON.stringify(line.endLink));
    if (draft && line.ignoreSync) p.setAttributeNS(STUDIO, 'studio:ignoreSync', 'true');
    if (line.agentRefs.length) p.setAttributeNS(TTM, 'ttm:agent', line.agentRefs.join(' '));
    const appendWord = (parent: Element, word: LyricWord, text: string) => {
      if (word.obscene) throw new Error(`Word ${word.id} has fields not yet mapped to TTML`);
      if (!draft && /^\s+$/.test(text) && word.beginMs === null && word.endMs === null && !word.rubyUnits.length && !word.emptyBeat) {
        parent.appendChild(xml.createTextNode(text));
        return;
      }
      const span = xml.createElementNS(TTML, 'span');
      if (draft) span.setAttributeNS(STUDIO, 'studio:id', word.id);
      if (draft && word.emptyBeat) span.setAttributeNS(STUDIO, 'studio:emptyBeat', String(word.emptyBeat));
      setTime(span, word.beginMs, word.endMs, draft);
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
          setTime(part, unit.beginMs, unit.endMs, draft);
          part.textContent = unit.reading;
          reading.appendChild(part);
        }
        span.appendChild(reading);
      }
      parent.appendChild(span);
    };
    for (const word of line.words) appendWord(p, word, word.text);
    for (const item of nonemptyTranslations(line.translations)) {
      const span = xml.createElementNS(TTML, 'span');
      span.setAttributeNS(TTM, 'ttm:role', 'x-translation');
      if (item.language) span.setAttributeNS(XML, 'xml:lang', item.language);
      span.textContent = item.text;
      p.appendChild(span);
    }
    const bg = backgrounds.get(line.id);
    if (bg) {
      if (bg.ignoreSync || bg.translations.length) throw new Error(`Background vocal ${bg.id} has fields not yet mapped to TTML`);
      const span = xml.createElementNS(TTML, 'span');
      span.setAttributeNS(TTM, 'ttm:role', 'x-bg');
      if (draft) span.setAttributeNS(STUDIO, 'studio:id', bg.id);
      setTime(span, bg.beginMs, bg.endMs, draft);
      bg.words.forEach((word, index) => appendWord(span, word, `${index === 0 ? '(' : ''}${word.text}${index === bg.words.length - 1 ? ')' : ''}`));
      p.appendChild(span);
    }
    div.appendChild(p);
  }
  return new XMLSerializer().serializeToString(xml).replace(/>([\s]+)</g, (_, whitespace: string) => `>${whitespace.replace(/\r/g, '&#13;').replace(/\n/g, '&#10;')}<`);
}
