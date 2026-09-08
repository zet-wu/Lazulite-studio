import { describe, expect, it } from 'vitest';
import { createEditorState, executeCommand, redo, undo } from '../src/domain/editing';
import { parseStudioTtml, serializeStudioTtml } from '../src/adapters/ttml';

const document = () => parseStudioTtml('<tt xmlns="http://www.w3.org/ns/ttml"><body><p xml:id="first" begin="0s" end="1s">hello</p><p xml:id="second">world</p></body></tt>');

describe('editor commands and history', () => {
  it('applies a batch atomically, syncs inline text, and keeps null timing valid', () => {
    const parsed = document(); const [first, second] = parsed.lines;
    let state = createEditorState(parsed);
    state = executeCommand(state, { type: 'update-lines', updates: [{ lineId: first.id, changes: { text: '你好', beginUs: null } }, { lineId: second.id, changes: { beginUs: 2_000_000, endUs: null } }] });
    expect(state.present.document.lines.map((line) => [line.text, line.beginUs, line.endUs])).toEqual([['你好', null, 1_000_000], ['world', 2_000_000, null]]);
    expect(state.present.document.lines[0].inline).toEqual([{ kind: 'text', text: '你好', editable: true }]);
    expect(state.past).toHaveLength(1);
  });

  it('rejects the whole transaction and parent-boundary violations', () => {
    const parsed = document(); const [first, second] = parsed.lines; const state = createEditorState(parsed);
    expect(() => executeCommand(state, { type: 'update-lines', updates: [{ lineId: first.id, changes: { text: 'changed' } }, { lineId: second.id, changes: { beginUs: 3, endUs: 2 } }] })).toThrow(/beginUs/);
    expect(state.present.document.lines[0].text).toBe('hello');
    const parent = parseStudioTtml('<tt xmlns="http://www.w3.org/ns/ttml"><body><div begin="2s" end="4s"><p> x </p></div></body></tt>');
    const parentId = parent.lines[0].id; const parentState = createEditorState(parent);
    expect(() => executeCommand(parentState, { type: 'update-line', lineId: parentId, changes: { beginUs: 1_000_000 } })).toThrow(/parent timing/);
    expect(() => executeCommand(parentState, { type: 'update-line', lineId: parentId, changes: { beginUs: 5_000_000, endUs: null } })).toThrow(/parent timing/);
  });

  it('keeps no-op out of history and restores review plus serialized document', () => {
    const parsed = parseStudioTtml('<tt xmlns="http://www.w3.org/ns/ttml"><body><p xml:id="first" begin="0s" end="1s">hello</p></body></tt>');
    const lineId = parsed.lines[0].id; let state = createEditorState(parsed, { lineReviews: { [lineId]: { status: 'confirmed' } } });
    expect(executeCommand(state, { type: 'update-line', lineId, changes: { text: 'hello' } })).toBe(state);
    state = executeCommand(state, { type: 'update-line', lineId, changes: { text: 'changed' } });
    expect(state.present.workflow?.lineReviews?.[lineId].status).toBe('needs-review');
    const restored = undo(state);
    expect(restored.present.workflow?.lineReviews?.[lineId].status).toBe('confirmed');
    expect(serializeStudioTtml(restored.present.document)).toBe(serializeStudioTtml(parsed));
    expect(redo(restored).present.document.lines[0].text).toBe('changed');
  });

  it('rejects real Ruby text and timing edits as read-only', () => {
    const parsed = parseStudioTtml('<tt xmlns="http://www.w3.org/ns/ttml" xmlns:tts="http://www.w3.org/ns/ttml#styling"><body><p xml:id="plain">ok</p><p xml:id="ruby" begin="0s" end="1s"><span tts:ruby="container"><span tts:ruby="base">今</span><span tts:ruby="text">いま</span></span></p></body></tt>');
    const lineId = parsed.lines[1].id; const state = createEditorState(parsed);
    expect(() => executeCommand(state, { type: 'update-line', lineId, changes: { text: 'x' } })).toThrow(/Ruby/);
    expect(() => executeCommand(state, { type: 'update-line', lineId, changes: { beginUs: 5 } })).toThrow(/timing is read-only/);
  });

  it('bounds undo history at twenty snapshots', () => {
    const parsed = document(); const lineId = parsed.lines[0].id; let state = createEditorState(parsed);
    for (let index = 0; index < 25; index += 1) state = executeCommand(state, { type: 'update-line', lineId, changes: { text: `v${index}` } });
    expect(state.past).toHaveLength(20);
  });
});
