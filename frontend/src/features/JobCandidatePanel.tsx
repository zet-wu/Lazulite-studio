import { useState } from 'react';
import type { JobResult, ReadingProposal } from '../adapters/http/jobs';
import { createLine, createLyricDocument, lineText, type AlignmentUnit, type LyricDocument, type LyricLine, type LyricWord } from '../domain/lyric-document';
import type { LyricCommand } from '../domain/lyric-commands';

function candidateDocument(lines: Array<{ text?: string; id?: string; start?: number | null; end?: number | null; begin_ms?: number | null; end_ms?: number | null }>): LyricDocument {
  if (!lines.length) throw new Error('候选没有歌词行');
  const document = createLyricDocument();
  document.lines = lines.map((item, index) => {
    const line = createLine(item.text ?? '', item.id || `proposal-${index + 1}`);
    line.beginMs = item.begin_ms ?? (item.start == null ? null : Math.round(item.start * 1_000));
    line.endMs = item.end_ms ?? (item.end == null ? null : Math.round(item.end * 1_000));
    if (line.words.length) { line.words[0].beginMs = line.beginMs; line.words[0].endMs = line.endMs; }
    return line;
  });
  return document;
}

function wordsAtRange(line: LyricLine, begin: number, end: number, text: string): LyricWord[] | null {
  let offset = 0;
  let first = -1;
  for (const [index, word] of line.words.entries()) {
    const next = offset + Array.from(word.text).length;
    if (offset === begin) first = index;
    if (next === end && first >= 0) {
      const words = line.words.slice(first, index + 1);
      return words.map((item) => item.text).join('') === text ? words : null;
    }
    offset = next;
  }
  return null;
}

function wordCovering(line: LyricLine, begin: number, end: number): LyricWord | null {
  let offset = 0;
  for (const word of line.words) {
    const next = offset + Array.from(word.text).length;
    if (offset <= begin && end <= next) return word;
    offset = next;
  }
  return null;
}

function readingCommands(document: LyricDocument, proposal: ReadingProposal): { commands: Extract<LyricCommand, { type: 'batch' }>['commands']; wordIds: string[] } | null {
  const line = document.lines.find((item) => item.id === proposal.line_id);
  if (!line || Array.from(lineText(line)).slice(proposal.base_start, proposal.base_end).join('') !== proposal.base) return null;
  const words = wordsAtRange(line, proposal.base_start, proposal.base_end, proposal.base);
  if (!words || words.some((word) => word.rubyUnits.length)) return null;
  if (words.length > 1 && words.some((word) => word.alignmentUnits.length || word.obscene || word.emptyBeat)) return null;
  const commands: Extract<LyricCommand, { type: 'batch' }>['commands'] = [];
  for (const word of words.slice(1)) commands.push({ type: 'merge-words', lineId: line.id, firstWordId: words[0].id, secondWordId: word.id });
  commands.push({ type: 'add-ruby', lineId: line.id, wordId: words[0].id, reading: proposal.reading });
  return { commands, wordIds: words.map((word) => word.id) };
}

export function JobCandidatePanel({ result, currentRevision, currentAssetId, dirty, document, onApply }: {
  result: JobResult | null; currentRevision: string; currentAssetId: string | null; dirty: boolean; document: LyricDocument; onApply: (command: LyricCommand) => void;
}) {
  const [selected, setSelected] = useState(0);
  const [message, setMessage] = useState('');
  if (!result) return <section aria-label="任务候选">请选择已完成任务查看候选。</section>;
  const stale = dirty || result.binding?.revision !== currentRevision || result.binding?.asset_id !== currentAssetId;
  const apply = () => {
    if (stale) return;
    try {
      if (result.kind === 'search') return;
      if (result.kind === 'fetch') {
        const lines = result.items[selected]?.lines;
        if (!lines?.length) throw new Error('取词候选没有歌词行');
        onApply({ type: 'replace-document', document: candidateDocument(lines) });
      } else if (result.kind === 'transcribe') {
        onApply({ type: 'replace-document', document: candidateDocument(result.segments) });
      } else if (result.kind === 'line_align') {
        const commands: LyricCommand[] = result.lines.filter((item) => document.lines.some((line) => line.id === item.line_id)).map((item) => ({ type: 'set-line-time', lineId: item.line_id, beginMs: item.begin_ms ?? null, endMs: item.end_ms ?? null }));
        if (!commands.length) throw new Error('没有可应用的行时间');
        onApply({ type: 'batch', commands: commands as Extract<LyricCommand, { type: 'set-line-time' }>[] });
      } else if (result.kind === 'reading') {
        const used = new Set<string>();
        const accepted = result.proposals.map((item) => readingCommands(document, item)).filter((item) => {
          if (!item || item.wordIds.some((id) => used.has(id))) return false;
          item.wordIds.forEach((id) => used.add(id));
          return true;
        });
        const commands = accepted.flatMap((item) => item!.commands);
        if (!commands.length) throw new Error('候选范围未与词块边界对齐，或词已有读音及附属属性');
        onApply({ type: 'batch', commands });
        setMessage(`已应用 ${accepted.length} 个读音；其余候选需要先分词或已有读音。`);
        return;
      } else if (result.kind === 'forced_align') {
        const commands: Array<Extract<LyricCommand, { type: 'set-word-time' | 'set-ruby-time' | 'set-word-alignments' }>> = [];
        const attachments = new Map<string, { lineId: string; word: LyricWord; units: AlignmentUnit[] }>();
        for (const [index, unit] of result.units.entries()) {
          const line = document.lines.find((item) => item.id === unit.line_id);
          if (!line || unit.start_ms === null || unit.end_ms === null) continue;
          const ruby = line.words.flatMap((word) => word.rubyUnits.map((item) => ({ word, item }))).find(({ item }) => item.id === unit.ruby_id);
          const range = unit.source_range ?? unit.input_range;
          const word = ruby?.word ?? wordCovering(line, range[0], range[1]);
          if (!word || unit.granularity === 'character') continue;
          const attachment = attachments.get(word.id) ?? { lineId: line.id, word, units: [...word.alignmentUnits] };
          const entry: AlignmentUnit = { id: `${result.job_id ?? 'forced'}:${line.id}:${index}`, kind: unit.granularity, text: unit.text, beginMs: unit.start_ms, endMs: unit.end_ms,
            readingStart: ruby ? unit.input_range[0] : null, readingEnd: ruby ? unit.input_range[1] : null, rubyUnitId: ruby?.item.id ?? null };
          attachment.units = [...attachment.units.filter((item) => item.id !== entry.id), entry];
          attachments.set(word.id, attachment);
          if (ruby && unit.granularity === 'word') { commands.push({ type: 'set-ruby-time', lineId: line.id, wordId: ruby.word.id, rubyId: ruby.item.id, beginMs: unit.start_ms, endMs: unit.end_ms }); continue; }
          if (word && unit.granularity === 'word') commands.push({ type: 'set-word-time', lineId: line.id, wordId: word.id, beginMs: unit.start_ms, endMs: unit.end_ms });
        }
        for (const { lineId, word, units } of attachments.values()) commands.push({ type: 'set-word-alignments', lineId, wordId: word.id, units });
        if (!commands.length) throw new Error('没有与词块或 注音 单元对应的时间候选');
        onApply({ type: 'batch', commands });
        setMessage(`已应用 ${commands.length} 个时间单元；未匹配的片段未修改。`);
        return;
      }
      setMessage('候选已应用');
    } catch (error) { setMessage(error instanceof Error ? error.message : '应用候选失败'); }
  };
  return <section aria-label="任务候选"><h2>任务候选 · {result.kind}</h2>
    {stale && <p role="alert">结果绑定的 revision/asset 已过期，或有未保存编辑。</p>}
    {result.kind === 'search' && result.items.map((item, index) => <p key={index}>{item.title ?? '未知标题'} · {item.artist ?? '未知艺人'}</p>)}
    {result.kind === 'fetch' && <><select aria-label="取词版本" value={selected} onChange={(event) => setSelected(Number(event.target.value))}>{result.items.map((item, index) => <option key={index} value={index}>{item.candidate?.title ?? `版本 ${index + 1}`}</option>)}</select><ol>{result.items[selected]?.lines?.map((line, index) => <li key={index}>{line.text}</li>)}</ol></>}
    {result.kind === 'transcribe' && <ol>{result.segments.map((item, index) => <li key={index}>{item.text}</li>)}</ol>}
    {result.kind === 'line_align' && <ol>{result.lines.map((item) => <li key={item.line_id}>{item.line_id}: {item.begin_ms == null ? '未定' : `${item.begin_ms / 1e3}s`}–{item.end_ms == null ? '未定' : `${item.end_ms / 1e3}s`}</li>)}</ol>}
    {result.kind === 'reading' && <ol>{result.proposals.map((item) => <li key={item.proposal_id}>{item.base} → {item.reading} · {readingCommands(document, item) ? '可应用' : '需先分词或已有读音'}</li>)}</ol>}
    {result.kind === 'forced_align' && <ol>{result.units.map((item, index) => <li key={index}>{item.text} · {item.granularity} · {item.start_ms == null ? '未定' : `${item.start_ms / 1e3}s`}</li>)}</ol>}
    {result.kind !== 'search' && <button disabled={stale} onClick={apply}>人工应用候选</button>}
    {message && <p role="status">{message}</p>}
  </section>;
}
