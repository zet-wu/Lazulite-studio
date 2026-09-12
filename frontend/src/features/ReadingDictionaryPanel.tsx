import { useEffect, useState } from "react";
import { readingApi, type ReadingDictionaryEntry } from "../adapters/http/reading";
import styles from "./ruby-panel.module.css";

export function ReadingDictionaryPanel({ projectId }: { projectId: string }) {
  const [items, setItems] = useState<ReadingDictionaryEntry[]>([]);
  const [surface, setSurface] = useState("");
  const [reading, setReading] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const load = async () => {
    try {
      setItems((await readingApi.list(projectId)).items);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "词典读取失败");
    }
  };
  useEffect(() => { void load(); }, [projectId]);
  const clear = () => { setSurface(""); setReading(""); setEditing(null); };
  const save = async () => {
    if (!surface.trim() || !reading.trim()) {
      setMessage("正文和读音不能为空");
      return;
    }
    try {
      const entry = editing
        ? await readingApi.update(projectId, editing, surface, reading)
        : await readingApi.create(projectId, surface, reading);
      setItems((current) => editing ? current.map((item) => item.id === entry.id ? entry : item) : [...current, entry].sort((a, b) => a.surface.localeCompare(b.surface)));
      clear();
      setMessage("词典已保存");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "词典保存失败");
    }
  };
  const remove = async (entry: ReadingDictionaryEntry) => {
    try {
      await readingApi.remove(projectId, entry.id);
      setItems((current) => current.filter((item) => item.id !== entry.id));
      if (editing === entry.id) clear();
      setMessage("词典项已删除");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "词典删除失败");
    }
  };
  return (
    <section className={styles.dictionary} aria-label="读音词典">
      <p className={styles.note}>只影响之后生成的候选，不改写已确认歌词。</p>
      <div className={styles.dictionaryForm}>
        <input value={surface} onChange={(event) => setSurface(event.target.value)} placeholder="正文" aria-label="词典正文" />
        <input value={reading} onChange={(event) => setReading(event.target.value)} placeholder="读音" aria-label="词典读音" />
        <button onClick={() => void save()}>{editing ? "更新" : "添加"}</button>
        {editing && <button onClick={clear}>取消</button>}
      </div>
      {items.length === 0 ? <p className={styles.note}>暂无词典项</p> : items.map((entry) => (
        <div className={styles.dictionaryRow} key={entry.id}>
          <span>{entry.surface}</span><span>→ {entry.reading}</span>
          <button onClick={() => { setEditing(entry.id); setSurface(entry.surface); setReading(entry.reading); }}>编辑</button>
          <button onClick={() => void remove(entry)}>删除</button>
        </div>
      ))}
      {message && <p className={styles.message} role="status">{message}</p>}
    </section>
  );
}
