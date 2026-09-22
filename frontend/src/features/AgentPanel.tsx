import { useState, type FormEvent } from "react";
import type { StudioAgent } from "../domain/document";
import styles from "./agent-panel.module.css";

export function AgentPanel({
  agents,
  onChange,
}: {
  agents: StudioAgent[];
  onChange: (agents: StudioAgent[]) => void;
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const safeChange = (next: StudioAgent[]) => {
    try {
      onChange(next);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "歌手修改失败");
    }
  };
  const add = (event: FormEvent) => {
    event.preventDefault();
    const value = name.trim();
    if (!value) return;
    safeChange([
      ...agents,
      {
        id: `agent-${crypto.randomUUID()}`,
        name: value,
        type: "person",
        actorRef: null,
        groupRefs: [],
        sourcePath: [],
        raw: {
          type: "element",
          namespaceURI: null,
          localName: "agent",
          prefix: null,
          attributes: [],
          children: [],
        },
      },
    ]);
    setName("");
  };
  return (
    <section className={styles.panel} aria-label="歌手管理">
      <strong>歌手与组合</strong>
      {error && <p role="alert">{error}</p>}
      {agents.map((agent) => (
        <div className={styles.card} key={agent.id}>
          <div className={styles.row}>
            <input
              aria-label={`${agent.name ?? "未命名"}名称`}
              value={agent.name ?? ""}
              placeholder="未命名"
              onChange={(event) =>
                safeChange(
                  agents.map((item) =>
                    item.id === agent.id
                      ? { ...item, name: event.target.value }
                      : item,
                  ),
                )
              }
            />
            <select
              aria-label={`${agent.name ?? "未命名"}类型`}
              value={agent.type ?? "person"}
              onChange={(event) =>
                safeChange(
                  agents.map((item) =>
                    item.id === agent.id
                      ? { ...item, type: event.target.value }
                      : item,
                  ),
                )
              }
            >
              <option value="person">个人</option>
              <option value="group">组合</option>
            </select>
            <button
              type="button"
              onClick={() =>
                safeChange(agents.filter((item) => item.id !== agent.id))
              }
            >
              删除
            </button>
          </div>
          {agent.type === "group" && (
            <fieldset>
              <legend>组合成员</legend>
              {agents
                .filter(
                  (member) => member.id !== agent.id && member.type !== "group",
                )
                .map((member) => (
                  <label key={member.id}>
                    <input
                      type="checkbox"
                      checked={agent.groupRefs.includes(member.id)}
                      onChange={(event) =>
                        safeChange(
                          agents.map((item) =>
                            item.id === agent.id
                              ? {
                                  ...item,
                                  groupRefs: event.target.checked
                                    ? [...item.groupRefs, member.id]
                                    : item.groupRefs.filter(
                                        (id) => id !== member.id,
                                      ),
                                }
                              : item,
                          ),
                        )
                      }
                    />
                    {member.name ?? "未命名"}
                  </label>
                ))}
            </fieldset>
          )}
        </div>
      ))}
      <form className={styles.add} onSubmit={add}>
        <input
          aria-label="新歌手名称"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="添加歌手或组合"
        />
        <button type="submit">添加</button>
      </form>
    </section>
  );
}
