import type { TtmlAttribute, TtmlNode, TimeUs } from '../../domain/ttml';
import type { InlineNode, StudioAgent, StudioLine, StudioLyricDocument, StudioRuby, SourceTiming } from '../../domain/document';
import { STUDIO_SCHEMA_VERSION } from '../../domain/document';
export const TTML_NS = 'http://www.w3.org/ns/ttml';
export const TTM_NS = 'http://www.w3.org/ns/ttml#metadata';
export const TTS_NS = 'http://www.w3.org/ns/ttml#styling';
export const STUDIO_DRAFT_NS = 'urn:lazulite:studio:draft';
const XML_NS = 'http://www.w3.org/XML/1998/namespace';
const XMLNS_NS = 'http://www.w3.org/2000/xmlns/';
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_DEPTH = 128;
const local = (e: Element) => e.localName || e.tagName.replace(/^.*:/, '');
const attr = (e: Element, ns: string | null, name: string) => Array.from(e.attributes).find(a => a.namespaceURI === ns && a.localName === name)?.value ?? null;
const cp = (s: string) => Array.from(s).length;
const safe = (n: number) => Number.isSafeInteger(n) && n >= 0 ? n : null;
function tree(n: Node): TtmlNode {
    if (n.nodeType === Node.TEXT_NODE)
        return { type: 'text', value: n.nodeValue || '' };
    if (n.nodeType === Node.CDATA_SECTION_NODE)
        return { type: 'cdata', value: n.nodeValue || '' };
    if (n.nodeType === Node.COMMENT_NODE)
        return { type: 'comment', value: n.nodeValue || '' };
    if (n.nodeType === Node.PROCESSING_INSTRUCTION_NODE)
        return { type: 'processing-instruction', target: (n as ProcessingInstruction).target, value: n.nodeValue || '' };
    if (n.nodeType !== Node.ELEMENT_NODE)
        throw new Error(`Unsupported XML node type ${n.nodeType}`);
    const e = n as Element;
    return { type: 'element', namespaceURI: e.namespaceURI, localName: local(e), prefix: e.prefix,
        attributes: Array.from(e.attributes).map((a): TtmlAttribute => ({ namespaceURI: a.namespaceURI, localName: a.localName, prefix: a.prefix, name: a.name, value: a.value })),
        children: Array.from(e.childNodes).map(tree) };
}
function parseTime(raw: string | null): TimeUs {
    if (raw === null)
        return null;
    const s = raw.trim();
    let seconds: number;
    if (/^\d+(?:\.\d+)?s$/.test(s))
        seconds = Number.parseFloat(s);
    else if (/^\d+(?:\.\d+)?ms$/.test(s))
        seconds = Number.parseFloat(s) / 1000;
    else {
        const m = /^(\d+):(\d{2}):(\d{2})(?:\.(\d+))?$/.exec(s);
        if (!m || +m[2] >= 60 || +m[3] >= 60)
            return null;
        seconds = +m[1] * 3600 + +m[2] * 60 + +m[3] + (m[4] ? Number(`0.${m[4]}`) : 0);
    }
    return safe(Math.round(seconds * 1000000));
}
const timeText = (us: number) => `${(us / 1000000).toFixed(6).replace(/0+$/, '').replace(/\.$/, '')}s`;
type Timing = {
    begin: TimeUs;
    end: TimeUs;
    unknown: boolean;
};
function calc(e: Element, parent: Timing, issues: StudioLyricDocument['issues'], path: number[]): Timing {
    const bRaw = attr(e, null, 'begin');
    const eRaw = attr(e, null, 'end');
    const dRaw = attr(e, null, 'dur');
    const b = parseTime(bRaw);
    const end = parseTime(eRaw);
    const dur = parseTime(dRaw);
    for (const [name, raw, value] of [['begin', bRaw, b], ['end', eRaw, end], ['dur', dRaw, dur]] as const)
        if (raw !== null && value === null)
            issues.push({ code: 'unsupported-time', message: `${name}="${raw}" is read-only`, path });
    const base = attr(e, null, 'timeBase') ?? attr(e, 'http://www.w3.org/ns/ttml#parameter', 'timeBase');
    const sequential = attr(e, null, 'timeContainer') === 'seq';
    if (base && base !== 'media')
        issues.push({ code: 'unsupported-time-base', message: `timeBase="${base}" is read-only`, path });
    if (sequential)
        issues.push({ code: 'unsupported-seq', message: 'Sequential timing is read-only', path });
    if (parent.unknown || parent.begin === null || (base && base !== 'media') || sequential || (bRaw !== null && b === null) || (eRaw !== null && end === null) || (dRaw !== null && dur === null))
        return { begin: null, end: null, unknown: true };
    const begin = safe(parent.begin + (b ?? 0));
    if (begin === null)
        return { begin: null, end: null, unknown: true };
    const candidates: number[] = [];
    if (parent.end !== null)
        candidates.push(parent.end);
    if (end !== null) {
        const absoluteEnd = safe(parent.begin + end);
        if (absoluteEnd === null)
            return { begin: null, end: null, unknown: true };
        candidates.push(absoluteEnd);
    }
    if (dur !== null) {
        const durationEnd = safe(begin + dur);
        if (durationEnd === null)
            return { begin: null, end: null, unknown: true };
        candidates.push(durationEnd);
    }
    const finish = candidates.length ? Math.min(...candidates) : null;
    if (finish !== null && finish < begin)
        return { begin: null, end: null, unknown: true };
    return { begin, end: finish, unknown: false };
}
function inline(e: Element): {
    nodes: InlineNode[];
    text: string;
    ruby: StudioRuby[];
    plain: boolean;
} {
    let text = '';
    const ruby: StudioRuby[] = [];
    let plain = true;
    const visit = (n: Node): InlineNode | null => {
        if (n.nodeType === Node.TEXT_NODE || n.nodeType === Node.CDATA_SECTION_NODE) {
            const value = n.nodeValue || '';
            text += value;
            return { kind: 'text', text: value, editable: true };
        }
        if (n.nodeType !== Node.ELEMENT_NODE) {
            plain = false;
            return null;
        }
        const child = n as Element;
        plain = false;
        if (child.namespaceURI !== TTML_NS) {
            return { kind: 'element', name: child.tagName, children: [], editable: false, reason: 'unknown inline namespace', raw: tree(child) };
        }
        if (local(child) === 'br') {
            text += '\n';
            plain = false;
            return { kind: 'element', name: 'br', children: [], editable: false, reason: 'line break structure', raw: tree(child) };
        }
        const rubyKind = attr(child, TTS_NS, 'ruby');
        if (rubyKind && rubyKind !== 'none' && rubyKind !== 'base') {
            plain = false;
            const children = Array.from(child.children);
            const base = children.find(x => attr(x, TTS_NS, 'ruby') === 'base');
            const reading = children.find(x => attr(x, TTS_NS, 'ruby') === 'text');
            if (rubyKind === 'container' && base && reading && children.length === 2 && Array.from(base.childNodes).every(x => x.nodeType === Node.TEXT_NODE || x.nodeType === Node.CDATA_SECTION_NODE) && Array.from(reading.childNodes).every(x => x.nodeType === Node.TEXT_NODE || x.nodeType === Node.CDATA_SECTION_NODE)) {
                const baseText = base.textContent || '';
                const readingText = reading.textContent || '';
                const start = cp(text);
                text += baseText;
                ruby.push({ base: baseText, reading: readingText, baseStart: start, baseEnd: cp(text) });
                return { kind: 'element', name: child.tagName, children: [], editable: false, reason: 'ruby structure', raw: tree(child) };
            }
            return { kind: 'element', name: child.tagName, children: [], editable: false, reason: 'unsupported ruby structure', raw: tree(child) };
        }
        const children = Array.from(child.childNodes).map(visit).filter((x): x is InlineNode => x !== null);
        return { kind: 'element', name: child.tagName, children, editable: false, reason: 'structured inline', raw: tree(child) };
    };
    const nodes = Array.from(e.childNodes).map(visit).filter((x): x is InlineNode => x !== null);
    return { nodes, text, ruby, plain };
}
function elementAt(root: Element, path: number[]) { let current = root; for (const i of path) {
    const child = current.children[i];
    if (!child)
        return null;
    current = child;
} return current; }
function checkAgentRefs(lines: StudioLine[], agents: StudioAgent[], issues: StudioLyricDocument['issues']) {
    const ids = new Set(agents.map(a => a.id));
    for (const line of lines)
        for (const id of line.agentRefs)
            if (!ids.has(id))
                issues.push({ code: 'dangling-agent', message: `Unknown agent reference "${id}"`, path: line.sourcePath });
    for (const agent of agents)
        if (agent.actorRef && !ids.has(agent.actorRef))
            issues.push({ code: 'dangling-actor', message: `Unknown actor reference "${agent.actorRef}"`, path: agent.sourcePath });
    const graph = new Map(agents.map(a => [a.id, a.actorRef ? [a.actorRef] : []]));
    const visit = (id: string, seen: Set<string>): boolean => { if (seen.has(id))
        return true; const nextSeen = new Set(seen); nextSeen.add(id); return (graph.get(id) || []).some(next => visit(next, nextSeen)); };
    for (const a of agents)
        if (visit(a.id, new Set()))
            issues.push({ code: 'agent-cycle', message: `Agent actor cycle at "${a.id}"`, path: a.sourcePath });
}
function hasUnknownLineAttributes(element: Element): boolean {
    const allowed = new Set(['begin', 'end', 'dur', 'timeContainer', 'timeBase', 'type']);
    return Array.from(element.attributes).some(attribute => {
        if (attribute.namespaceURI === XMLNS_NS || attribute.namespaceURI === XML_NS || attribute.namespaceURI === STUDIO_DRAFT_NS)
            return false;
        if (attribute.namespaceURI === TTM_NS)
            return attribute.localName !== 'agent';
        if (attribute.namespaceURI === TTS_NS)
            return true;
        if (attribute.namespaceURI === 'http://www.w3.org/ns/ttml#parameter')
            return attribute.localName !== 'timeBase';
        return attribute.namespaceURI === null ? !allowed.has(attribute.localName) : true;
    });
}
function hasUnknownAncestor(element: Element, root: Element): boolean {
    let current: Element | null = element;
    while (current) {
        if (hasUnknownLineAttributes(current))
            return true;
        if (current === root)
            break;
        current = current.parentElement;
    }
    return false;
}
function isLyricsLine(element: Element, root: Element): boolean {
    let parent = element.parentElement;
    let body: Element | null = null;
    while (parent && parent !== root) {
        if (parent.namespaceURI !== TTML_NS || !['body', 'div'].includes(local(parent)))
            return false;
        if (local(parent) === 'body')
            body = parent;
        parent = parent.parentElement;
    }
    return body !== null && body.parentElement === root;
}
export function parseStudioTtml(xml: string): StudioLyricDocument {
    if (new TextEncoder().encode(xml).byteLength > MAX_BYTES)
        throw new Error('TTML exceeds 2 MiB limit');
    if (/<!DOCTYPE/i.test(xml) || /<!ENTITY/i.test(xml))
        throw new Error('DTD and external entities are not accepted');
    const parsed = new DOMParser().parseFromString(xml, 'application/xml');
    const root = parsed.documentElement;
    const parserError = parsed.getElementsByTagName('parsererror')[0];
    if (parserError || !root)
        throw new Error(`Invalid XML${parserError?.textContent ? `: ${parserError.textContent.trim()}` : ''}`);
    if (root.namespaceURI !== TTML_NS || local(root) !== 'tt')
        throw new Error('Root must be TTML tt element');
    const issues: StudioLyricDocument['issues'] = [];
    const lines: StudioLine[] = [];
    const agents: StudioAgent[] = [];
    const metadata: TtmlNode[] = [];
    const extensions: TtmlNode[] = [];
    const walk = (e: Element, parent: Timing, path: number[], depth: number, parentPath: number[]) => {
        if (depth > MAX_DEPTH)
            throw new Error('TTML nesting exceeds depth 128');
        const current = calc(e, parent, issues, path);
        const name = local(e);
        const isMetadata = e.namespaceURI === TTML_NS && name === 'metadata';
        if (isMetadata)
            metadata.push(tree(e));
        if (e.namespaceURI === TTM_NS && name === 'agent') {
            const id = attr(e, XML_NS, 'id');
            const actor = Array.from(e.children).find(x => x.namespaceURI === TTM_NS && local(x) === 'actor');
            if (!id)
                issues.push({ code: 'invalid-agent', message: 'ttm:agent requires xml:id', path });
            else
                agents.push({ id, name: Array.from(e.children).find(x => x.namespaceURI === TTM_NS && local(x) === 'name')?.textContent || null, type: attr(e, null, 'type'), actorRef: actor ? attr(actor, null, 'agent') : null, groupRefs: [], sourcePath: path, raw: tree(e) });
        }
        if (e.namespaceURI !== TTML_NS && e.namespaceURI !== TTM_NS && e.namespaceURI !== TTS_NS && e !== root) {
            extensions.push(tree(e));
            issues.push({ code: 'unknown-namespace', message: `Unknown namespace ${e.namespaceURI || '(none)'}`, path });
        }
        if (e.namespaceURI === TTML_NS && name === 'p' && !isMetadata && isLyricsLine(e, root)) {
            const content = inline(e);
            const xmlId = attr(e, XML_NS, 'id');
            const id = `line-${path.join('-') || 'root'}`;
            const draft = attr(e, STUDIO_DRAFT_NS, 'null');
            const unknownAttributes = hasUnknownLineAttributes(e) || hasUnknownAncestor(e.parentElement || e, root);
            if (unknownAttributes)
                issues.push({ code: 'unknown-attribute', message: 'Unknown line attribute makes the line read-only', path });
            const begin = draft?.split(/\s+/).includes('begin') ? null : current.begin;
            const end = draft?.split(/\s+/).includes('end') ? null : current.end;
            const timing: SourceTiming = { begin: attr(e, null, 'begin'), end: attr(e, null, 'end'), dur: attr(e, null, 'dur'), parentBeginUs: parent.begin ?? 0, parentEndUs: parent.end, parentPath, relative: parent.begin !== 0 };
            const timingLocked = !content.plain || current.unknown || unknownAttributes || (attr(e, null, 'timeContainer') === 'seq') || (attr(e, null, 'timeBase') && attr(e, null, 'timeBase') !== 'media');
            const textEditable = content.plain && !current.unknown && !unknownAttributes;
            const textReason = current.unknown ? 'Unknown timing is read-only' : unknownAttributes ? 'Unknown line attribute is read-only' : 'Ruby, mixed or nested inline content is read-only';
            lines.push({
                id,
                xmlId,
                text: content.text,
                beginUs: begin,
                endUs: end,
                agentRefs: (attr(e, TTM_NS, 'agent') || '').split(/\s+/).filter(Boolean),
                inline: content.nodes,
                ruby: content.ruby,
                sourcePath: path,
                parentPath,
                sourceTiming: timing,
                editable: { text: textEditable, timing: !timingLocked },
                locks: {
                    ...(!textEditable ? { text: textReason } : {}),
                    ...(timingLocked ? { timing: current.unknown ? 'Unknown or nested timing is read-only' : 'Structured inline timing is read-only' } : {})
                },
                baseline: {
                    text: content.text,
                    beginUs: begin,
                    endUs: end,
                    agentRefs: (attr(e, TTM_NS, 'agent') || '').split(/\s+/).filter(Boolean)
                }
            });
        }
        Array.from(e.children).forEach((child, i) => walk(child, current, [...path, i], depth + 1, path));
    };
    walk(root, { begin: 0, end: null, unknown: false }, [], 1, []);
    checkAgentRefs(lines, agents, issues);
    const rootTree = tree(root);
    const reasons = issues.map(x => x.message);
    const hasEditable = lines.some(x => x.editable.text || x.editable.timing);
    const hasLocked = lines.some(x => !x.editable.text || !x.editable.timing);
    const profile: StudioLyricDocument['profile'] = { category: hasEditable ? (issues.length || hasLocked ? 'mixed' : 'editable') : 'read-only', reasons };
    return { schemaVersion: STUDIO_SCHEMA_VERSION, rawXml: xml, baseline: { xml, root: rootTree }, root: rootTree, blocks: rootTree.type === 'element' ? rootTree.children : [], lines, agents, language: attr(root, XML_NS, 'lang'), metadata, extensions, profile, issues };
}
export function serializeStudioTtml(document: StudioLyricDocument, options: {
    draft?: boolean;
} = {}) {
    const draft = options.draft === true;
    if (!draft && document.lines.some(l => l.beginUs === null || l.endUs === null))
        throw new Error('Final TTML export requires complete valid line timing');
    if (!draft && document.profile.category === 'read-only')
        throw new Error('Final TTML export requires an editable or mixed profile');
    if (!draft && document.issues.length > 0)
        throw new Error('Final TTML export requires a clean validation profile');
    const baselineDocument = parseStudioTtml(document.baseline.xml);
    const agentShape = (items: StudioLyricDocument['agents']) => items.map(agent => [agent.id, agent.name, agent.type, agent.actorRef, agent.groupRefs]);
    const hasAgentChanges = JSON.stringify(agentShape(document.agents)) !== JSON.stringify(agentShape(baselineDocument.agents)) || document.lines.some(line => JSON.stringify(line.agentRefs) !== JSON.stringify(line.baseline.agentRefs));
    const hasChanges = hasAgentChanges || document.lines.some(line => line.text !== line.baseline.text || line.beginUs !== line.baseline.beginUs || line.endUs !== line.baseline.endUs || (draft && line.editable.timing && (line.beginUs === null || line.endUs === null)));
    if (!hasChanges)
        return document.baseline.xml;
    const parsed = new DOMParser().parseFromString(document.baseline.xml, 'application/xml');
    if (parsed.getElementsByTagName('parsererror')[0] || !parsed.documentElement)
        throw new Error('Invalid baseline XML');
    for (const line of document.lines) {
        const base = line.baseline;
        if (line.text === base.text && line.beginUs === base.beginUs && line.endUs === base.endUs && JSON.stringify(line.agentRefs) === JSON.stringify(base.agentRefs) && !(draft && (line.beginUs === null || line.endUs === null)))
            continue;
        const element = elementAt(parsed.documentElement, line.sourcePath);
        if (!element)
            throw new Error(`Line ${line.id} source path is missing`);
        const agentValue = line.agentRefs.join(' ');
        if (agentValue) element.setAttributeNS(TTM_NS, 'ttm:agent', agentValue);
        else element.removeAttributeNS(TTM_NS, 'agent');
        if (!line.editable.text && line.text !== base.text)
            throw new Error(`Line ${line.id} text is read-only`);
        if (!line.editable.timing && (line.beginUs !== base.beginUs || line.endUs !== base.endUs))
            throw new Error(`Line ${line.id} timing is read-only`);
        if (line.text !== base.text) {
            while (element.firstChild)
                element.removeChild(element.firstChild);
            element.appendChild(parsed.createTextNode(line.text));
        }
        const parentStart = line.sourceTiming.parentBeginUs;
        if (line.beginUs !== null && (!Number.isSafeInteger(line.beginUs) || line.beginUs < 0))
            throw new Error(`Line ${line.id} has invalid begin time`);
        if (line.endUs !== null && (!Number.isSafeInteger(line.endUs) || line.endUs < 0))
            throw new Error(`Line ${line.id} has invalid end time`);
        if (line.beginUs !== null && line.endUs !== null && line.endUs < line.beginUs)
            throw new Error(`Line ${line.id} end precedes begin`);
        if (line.beginUs !== null && (line.beginUs < parentStart || line.sourceTiming.parentEndUs !== null && line.beginUs > line.sourceTiming.parentEndUs))
            throw new Error(`Line ${line.id} exceeds its parent timing`);
        if (line.endUs !== null && line.sourceTiming.parentEndUs !== null && line.endUs > line.sourceTiming.parentEndUs)
            throw new Error(`Line ${line.id} exceeds its parent timing`);
        if (line.beginUs !== base.beginUs) {
            if (line.beginUs === null)
                element.removeAttribute('begin');
            else {
                const value = line.beginUs - parentStart;
                if (value < 0)
                    throw new Error(`Line ${line.id} begins before its parent`);
                element.setAttribute('begin', timeText(value));
            }
            if (element.hasAttribute('dur')) {
                element.removeAttribute('dur');
                if (line.endUs !== null) {
                    const endValue = line.endUs - parentStart;
                    if (endValue < 0)
                        throw new Error(`Line ${line.id} ends before its parent`);
                    element.setAttribute('end', timeText(endValue));
                }
            }
        }
        if (line.endUs !== base.endUs) {
            if (line.endUs === null)
                element.removeAttribute('end');
            else {
                const value = line.endUs - parentStart;
                if (value < 0)
                    throw new Error(`Line ${line.id} ends before its parent`);
                element.setAttribute('end', timeText(value));
            }
            if (element.hasAttribute('dur'))
                element.removeAttribute('dur');
        }
        const nulls = [line.beginUs === null ? 'begin' : '', line.endUs === null ? 'end' : ''].filter(Boolean).join(' ');
        if (draft && nulls && line.editable.timing) {
            parsed.documentElement.setAttributeNS(XMLNS_NS, 'xmlns:studio', STUDIO_DRAFT_NS);
            element.setAttributeNS(STUDIO_DRAFT_NS, 'studio:null', nulls);
        }
        else if (line.editable.timing)
            element.removeAttributeNS(STUDIO_DRAFT_NS, 'null');
    }
    const baselineIds = new Set(baselineDocument.agents.map(agent => agent.id));
    const removedAgents: Element[] = [];
    for (const baselineAgent of baselineDocument.agents) {
        const node = elementAt(parsed.documentElement, baselineAgent.sourcePath);
        if (!node) continue;
        const current = document.agents.find(agent => agent.id === baselineAgent.id);
        if (!current) { removedAgents.push(node); continue; }
        if (current.name !== baselineAgent.name) {
            let name = Array.from(node.children).find(child => child.namespaceURI === TTM_NS && local(child) === 'name');
            if (!name) { name = parsed.createElementNS(TTM_NS, 'ttm:name'); node.appendChild(name); }
            name.textContent = current.name ?? '';
        }
        if (current.type !== baselineAgent.type) {
            if (current.type) node.setAttribute('type', current.type); else node.removeAttribute('type');
        }
    }
    for (const node of removedAgents) node.parentElement?.removeChild(node);
    const newAgents = document.agents.filter(agent => !baselineIds.has(agent.id));
    if (newAgents.length) {
        const metadata = parsed.getElementsByTagNameNS(TTML_NS, 'metadata')[0] ?? (() => {
            let head = parsed.getElementsByTagNameNS(TTML_NS, 'head')[0];
            if (!head) { head = parsed.createElementNS(TTML_NS, 'head'); parsed.documentElement.insertBefore(head, parsed.documentElement.firstChild); }
            const node = parsed.createElementNS(TTML_NS, 'metadata'); head.appendChild(node); return node;
        })();
        for (const agent of newAgents) {
            if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(agent.id)) throw new Error(`Invalid agent id: ${agent.id}`);
            const node = parsed.createElementNS(TTM_NS, 'ttm:agent'); node.setAttributeNS(XML_NS, 'xml:id', agent.id);
            if (agent.type) node.setAttribute('type', agent.type);
            const name = parsed.createElementNS(TTM_NS, 'ttm:name'); name.textContent = agent.name ?? ''; node.appendChild(name); metadata.appendChild(node);
        }
    }
    return new XMLSerializer().serializeToString(parsed);
}
export function createStudioDocument(): StudioLyricDocument { return parseStudioTtml('<?xml version="1.0" encoding="UTF-8"?><tt xmlns="http://www.w3.org/ns/ttml" xmlns:studio="urn:lazulite:studio:draft"><body><p xml:id="line-1" studio:null="begin end"/></body></tt>'); }
