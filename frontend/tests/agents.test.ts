import { describe, expect, it } from "vitest";
import { parseStudioTtml, serializeStudioTtml } from "../src/adapters/ttml";
import { createEditorState, executeCommand, undo } from "../src/domain/editing";

describe("agent metadata round trip", () => {
  it("persists four agents, refs, rename and undo", () => {
    const document = parseStudioTtml('<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata"><head><ttm:agent xml:id="a1"><ttm:name>One</ttm:name></ttm:agent></head><body><p xml:id="line" ttm:agent="a1" begin="0s" end="1s">hello</p></body></tt>');
    const state = createEditorState(document);
    const agents = ["a1", "agent-two", "agent-three", "agent-four"].map((id, index) => ({ id, name: ["Renamed", "Two", "Three", "Four"][index], type: "person", actorRef: null, groupRefs: [], sourcePath: [], raw: document.agents[0].raw }));
    const updated = executeCommand(state, { type: "update-agents", agents });
    const assigned = executeCommand(updated, { type: "update-line", lineId: document.lines[0].id, changes: { agentRefs: ["agent-four"] } });
    const roundTrip = parseStudioTtml(serializeStudioTtml(assigned.present.document));
    expect(roundTrip.agents.map((agent) => [agent.id, agent.name])).toEqual([["a1", "Renamed"], ["agent-two", "Two"], ["agent-three", "Three"], ["agent-four", "Four"]]);
    expect(roundTrip.lines[0].agentRefs).toEqual(["agent-four"]);
    expect(undo(assigned).present.document.lines[0].agentRefs).toEqual(["a1"]);
  });
  it("creates a legal head and rejects deleting a referenced agent", () => {
    const document = parseStudioTtml('<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata"><body><p xml:id="line" ttm:agent="a1" begin="0s" end="1s">hello</p></body></tt>');
    const state = createEditorState(document);
    expect(() => executeCommand(state, { type: "update-agents", agents: [] })).toThrow(/still assigned/);
    const clean = createEditorState(parseStudioTtml('<tt xmlns="http://www.w3.org/ns/ttml"><body><p xml:id="line" begin="0s" end="1s">hello</p></body></tt>'));
    const added = executeCommand(clean, { type: "update-agents", agents: [{ id: "agent-a1", name: "One", type: "person", actorRef: null, groupRefs: [], sourcePath: [], raw: { type: "element", namespaceURI: null, localName: "agent", prefix: null, attributes: [], children: [] } }] });
    expect(parseStudioTtml(serializeStudioTtml(added.present.document)).agents[0].id).toBe("agent-a1");
  });
  it("keeps name extensions when only a lyric line changes", () => {
    const document = parseStudioTtml('<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" xmlns:x="urn:test"><head><ttm:agent xml:id="a1"><ttm:name>One<x:mark data="keep"/></ttm:name></ttm:agent></head><body><p xml:id="line" begin="0s" end="1s">hello</p></body></tt>');
    const state = createEditorState(document);
    const updated = executeCommand(state, { type: "update-line", lineId: document.lines[0].id, changes: { text: "changed" } });
    expect(serializeStudioTtml(updated.present.document, { draft: true })).toContain('data="keep"');
  });
  it("allows renaming an imported agent while preserving actor references", () => {
    const document = parseStudioTtml('<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata"><head><ttm:agent xml:id="a1"><ttm:name>One</ttm:name><ttm:actor agent="actor-1"/></ttm:agent><ttm:agent xml:id="actor-1"/></head><body/></tt>');
    const state = createEditorState(document);
    const updated = executeCommand(state, { type: "update-agents", agents: document.agents.map((agent) => agent.id === "a1" ? { ...agent, name: "Renamed" } : agent) });
    expect(updated.present.document.agents.find((agent) => agent.id === "a1")?.name).toBe("Renamed");
  });
});
