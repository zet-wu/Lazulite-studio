import { describe, expect, it } from 'vitest';
import { parseStudioTtml, serializeStudioTtml } from '../src/adapters/ttml/codec';
import { createEditorState, executeCommand, redo, undo } from '../src/domain/editing';

describe('S6 advanced editing', () => {
  it('round trips word and reading units', () => {
    const doc = parseStudioTtml('<tt xmlns="http://www.w3.org/ns/ttml" xmlns:tts="http://www.w3.org/ns/ttml#styling"><body><p begin="1s" end="5s">𝄞<span tts:ruby="container"><span tts:ruby="base">今日</span><span tts:ruby="text">きょう</span></span>歌</p></body></tt>');
    const line = doc.lines[0], ruby = line.ruby[0]; let state = createEditorState(doc);
    state = executeCommand(state, { type: 'update-timing-units', lineId: line.id, units: [
      { id: 'r1', kind: 'word', textStart: ruby.baseStart, textEnd: ruby.baseEnd, readingStart: 0, readingEnd: 1, rubyId: ruby.id, beginUs: 1_000_000, endUs: 2_000_000 },
      { id: 'r2', kind: 'word', textStart: ruby.baseStart, textEnd: ruby.baseEnd, readingStart: 1, readingEnd: 3, rubyId: ruby.id, beginUs: 2_000_000, endUs: 3_000_000 },
      { id: 'w', kind: 'word', textStart: ruby.baseEnd, textEnd: ruby.baseEnd + 1, readingStart: null, readingEnd: null, rubyId: null, beginUs: 3_000_000, endUs: 4_000_000 },
    ] });
    const timedUnits = state.present.document.lines[0].timingUnits.map(unit => ({ ...unit }));
    const restoredTiming = redo(undo(state));
    expect(restoredTiming.present.document.lines[0].timingUnits).toEqual(timedUnits);
    const reopened = parseStudioTtml(serializeStudioTtml(state.present.document));
    expect(reopened.lines[0].text).toBe('𝄞今日歌');
    expect(reopened.lines[0].ruby[0]).toMatchObject({ base: '今日', reading: 'きょう', baseStart: 1, baseEnd: 3 });
    expect(reopened.lines[0].timingUnits).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'r1', textStart: 1, textEnd: 3, readingStart: 0, readingEnd: 1, beginUs: 1_000_000, endUs: 2_000_000 }),
      expect.objectContaining({ id: 'r2', textStart: 1, textEnd: 3, readingStart: 1, readingEnd: 3, beginUs: 2_000_000, endUs: 3_000_000 }),
      expect.objectContaining({ id: 'w', textStart: 3, textEnd: 4, beginUs: 3_000_000, endUs: 4_000_000 }),
    ]));
    state = executeCommand(state, { type: 'update-ruby', lineId: line.id, ruby: [{ ...ruby, reading: 'きょ' }] });
    expect(state.present.document.lines[0].timingUnits).toHaveLength(1);
  });

  it('splits, saves, merges, and undoes line structure', () => {
    const doc = parseStudioTtml('<tt xmlns="http://www.w3.org/ns/ttml" xmlns:tts="http://www.w3.org/ns/ttml#styling" xmlns:studio="urn:lazulite:studio:draft"><body><p xml:id="a" begin="0s" end="2s">AABB</p><p xml:id="c" xml:lang="ja" begin="2s" end="4s">AA<span xml:id="ruby-keep" tts:ruby="container"><span tts:ruby="base">BB</span><span tts:ruby="text"><span studio:unit-id="u" begin="0.1s" end="0.5s">ビー</span></span></span></p><p xml:id="d" begin="4s" end="6s">AABB</p><ext xmlns="urn:x">keep</ext></body></tt>');
    const id = doc.lines[0].id, middleId = doc.lines[1].id, lastId = doc.lines[2].id; let state = createEditorState(doc, { lineReviews: { [id]: { status: 'confirmed' } } });
    state = executeCommand(state, { type: 'split-line', lineId: id, at: 2, newLineId: 'split-b' });
    const splitDoc = parseStudioTtml(serializeStudioTtml(state.present.document, { draft: true }));
    expect(splitDoc.lines.map(line => line.text)).toEqual(['AA', 'BB', 'AABB', 'AABB']);
    expect(splitDoc.lines).toHaveLength(4);
    state = executeCommand(state, { type: 'update-line', lineId: lastId, changes: { text: 'C!' } });
    state = executeCommand(state, { type: 'merge-lines', firstLineId: id, secondLineId: 'split-b' });
    const mergedDoc = parseStudioTtml(serializeStudioTtml(state.present.document, { draft: true }));
    expect(mergedDoc.lines.map(line => line.text)).toEqual(['AABB', 'AABB', 'C!']);
    expect(mergedDoc.lines[1].ruby[0].reading).toBe('ビー');
    expect(mergedDoc.lines[1].timingUnits[0].rubyId).toBe(mergedDoc.lines[1].ruby[0].id);
    expect(mergedDoc.lines[1].timingUnits[0].beginUs).toBe(2100000);
    let rubySplit = executeCommand(state, { type: 'split-line', lineId: middleId, at: 2, newLineId: 'ruby-tail' });
    const rubyReopened = parseStudioTtml(serializeStudioTtml(rubySplit.present.document, { draft: true }));
    expect(rubyReopened.lines[2].ruby[0].reading).toBe('ビー');
    expect(rubyReopened.lines[2].timingUnits[0].rubyId).toBe(rubyReopened.lines[2].ruby[0].id);
    const rubyXml = serializeStudioTtml(rubySplit.present.document, { draft: true });
    const rubyDom = new DOMParser().parseFromString(rubyXml, 'application/xml');
    const rubyTail = Array.from(rubyDom.getElementsByTagNameNS('http://www.w3.org/ns/ttml', 'p')).find((element) => element.getAttribute('xml:id') === 'ruby-tail');
    expect(rubyTail?.getAttributeNS('http://www.w3.org/XML/1998/namespace', 'lang')).toBe('ja');
    expect(Array.from(rubyTail?.getElementsByTagNameNS('http://www.w3.org/ns/ttml', 'span') ?? []).some((element) => element.getAttributeNS('http://www.w3.org/XML/1998/namespace', 'id') === 'ruby-keep')).toBe(true);
    const fidelityXml = '<tt xmlns="http://www.w3.org/ns/ttml" xmlns:tts="http://www.w3.org/ns/ttml#styling"><body><p xml:id="fidelity" xml:lang="ja"><span xml:id="ruby-one" tts:ruby="container"><span tts:ruby="base">今</span><span tts:ruby="text">いま</span></span><span xml:id="ruby-two" tts:ruby="container"><span tts:ruby="base">日</span><span tts:ruby="text">ひ</span></span></p></body></tt>';
    const fidelityDoc = parseStudioTtml(fidelityXml);
    let fidelityState = executeCommand(createEditorState(fidelityDoc), { type: 'split-line', lineId: fidelityDoc.lines[0].id, at: 1, newLineId: 'fidelity-tail' });
    let fidelityDom = new DOMParser().parseFromString(serializeStudioTtml(fidelityState.present.document, { draft: true }), 'application/xml');
    expect(Array.from(fidelityDom.getElementsByTagNameNS('http://www.w3.org/ns/ttml', 'span')).some((node) => node.getAttributeNS('http://www.w3.org/XML/1998/namespace', 'id') === 'ruby-two')).toBe(true);
    fidelityState = executeCommand(fidelityState, { type: 'merge-lines', firstLineId: fidelityDoc.lines[0].id, secondLineId: 'fidelity-tail' });
    fidelityDom = new DOMParser().parseFromString(serializeStudioTtml(fidelityState.present.document, { draft: true }), 'application/xml');
    expect(Array.from(fidelityDom.getElementsByTagNameNS('http://www.w3.org/ns/ttml', 'span')).map((node) => node.getAttributeNS('http://www.w3.org/XML/1998/namespace', 'id')).filter(Boolean)).toEqual(expect.arrayContaining(['ruby-one', 'ruby-two']));
    expect(fidelityDom.getElementsByTagNameNS('http://www.w3.org/ns/ttml', 'p')[0].getAttributeNS('http://www.w3.org/XML/1998/namespace', 'lang')).toBe('ja');
    expect(undo(state).present.document.lines.map(line => line.id)).toEqual([id, 'split-b', middleId, lastId]);
  });

  it('persists groups and rejects dangling cycles', () => {
    const doc = parseStudioTtml('<tt xmlns="http://www.w3.org/ns/ttml"><head><metadata xmlns:ttm="http://www.w3.org/ns/ttml#metadata"><ttm:agent xml:id="a" type="group"/><ttm:agent xml:id="b"/></metadata></head><body><p>ok</p></body></tt>');
    let state = createEditorState(doc); state = executeCommand(state, { type: 'update-agents', agents: doc.agents.map(agent => agent.id === 'a' ? { ...agent, groupRefs: ['b'] } : agent) });
    expect(parseStudioTtml(serializeStudioTtml(state.present.document, { draft: true })).agents[0].groupRefs).toEqual(['b']);
    expect(() => executeCommand(state, { type: 'update-agents', agents: doc.agents.map(agent => ({ ...agent, groupRefs: [agent.id === 'a' ? 'b' : 'a'] })) })).toThrow(/cycle/);
  });
});
