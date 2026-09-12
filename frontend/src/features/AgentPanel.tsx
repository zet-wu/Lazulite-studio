import { useState, type FormEvent } from "react";
import type { StudioAgent } from "../domain/document";

export function AgentPanel({ agents, onChange }: { agents: StudioAgent[]; onChange: (agents: StudioAgent[]) => void }) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const safeChange = (next: StudioAgent[]) => { try { onChange(next); setError(null); } catch (caught) { setError(caught instanceof Error ? caught.message : "歌手修改失败"); } };
  const add = (event: FormEvent) => { event.preventDefault(); const value = name.trim(); if (!value) return; safeChange([...agents, { id: `agent-${crypto.randomUUID()}`, name: value, type: "person", actorRef: null, groupRefs: [], sourcePath: [], raw: { type: "element", namespaceURI: null, localName: "agent", prefix: null, attributes: [], children: [] } }]); setName(""); };
  return <section aria-label="歌手管理"><strong>歌手</strong>{error && <p role="alert">{error}</p>}{agents.map((agent) => <div key={agent.id}>{agent.name ?? "未命名"} <small>{agent.type ?? "未知类型"}</small><button type="button" onClick={() => { const next = window.prompt("歌手名称", agent.name ?? ""); if (next?.trim()) safeChange(agents.map((item) => item.id === agent.id ? { ...item, name: next.trim() } : item)); }}>改名</button><button type="button" onClick={() => safeChange(agents.filter((item) => item.id !== agent.id))}>删除</button></div>)}<form onSubmit={add}><input aria-label="新歌手名称" value={name} onChange={(event) => setName(event.target.value)} placeholder="添加歌手" /><button type="submit">添加</button></form></section>;
}
