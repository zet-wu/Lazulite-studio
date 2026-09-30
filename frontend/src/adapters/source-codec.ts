import { createLyricDocument, createLine, createWord, lineText, type LyricDocument, type LyricLine, type RomanizationTrack } from '../domain/lyric-document';
const time = (ms: number) => { if (!Number.isFinite(ms) || ms < 0) throw new Error('歌词时间无效'); return Math.round(ms * 1000); };
export function parseWordFormat(text: string, kind: 'krc' | 'qrc' | 'yrc'): LyricDocument {
  if (kind === 'qrc' && text.trim().startsWith('<')) {
    const xml = new DOMParser().parseFromString(text, 'application/xml');
    const content = xml.querySelector('[LyricContent]')?.getAttribute('LyricContent');
    if (!content) throw new Error('QRC XML 缺少 LyricContent'); text = content;
  }
  const d = createLyricDocument(); d.lines = [];
  const offset = Number(text.match(/^\[offset:([+-]?\d+)\]/m)?.[1] ?? 0);
  for (const raw of text.split(/\r?\n/)) {
    const row = raw.match(/^\[(\d+),(\d+)\](.*)$/); if (!row) continue;
    const start = Number(row[1]), line = createLine(''); line.beginUs = time(start + offset); line.endUs = time(start + Number(row[2]) + offset);
    const pattern = kind === 'krc' ? /<(\d+),(\d+),\d+>([^<]*)/g : kind === 'yrc' ? /\((\d+),(\d+),\d+\)([^()]*)/g : /([^()]*?)\((\d+),(\d+)\)/g;
    let consumed = 0;
    for (const m of row[3].matchAll(pattern)) {
      if (m.index !== consumed) throw new Error('逐词标签之间含无法解析的文字');
      const wordText = kind === 'qrc' ? m[1] : m[3], begin = Number(kind === 'qrc' ? m[2] : m[1]) + (kind === 'krc' ? start : 0) + offset, duration = Number(kind === 'qrc' ? m[3] : m[2]);
      line.words.push({ ...createWord(wordText), beginUs: time(begin), endUs: time(begin + duration) }); consumed = m.index + m[0].length;
    }
    if (consumed !== row[3].length || !line.words.length) throw new Error('逐词歌词标签不完整');
    d.lines.push(line);
  }
  if (!d.lines.length) throw new Error('未解析出逐词歌词');
  if (kind === 'krc') {
    const language = text.match(/^\[language:([^\]]+)\]/m)?.[1];
    if (language) {
      const payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(language), c => c.charCodeAt(0))));
      for (const part of payload.content ?? []) {
        if (part.type !== 0 && part.type !== 1) continue;
        if (!Array.isArray(part.lyricContent) || part.lyricContent.length !== d.lines.length) throw new Error('KRC 附属内容行数与正文不符');
        const track: RomanizationTrack = { id: crypto.randomUUID(), language: null, contents: [] };
        part.lyricContent.forEach((values: string[], i: number) => {
          if (!Array.isArray(values) || values.some(v => typeof v !== 'string')) throw new Error('KRC 附属内容无效');
          const line = d.lines[i];
          if (part.type === 1) { if (values.join('')) line.translations.push({ language: null, text: values.join('') }); }
          else if (values.length === line.words.length) track.contents.push({ id: crypto.randomUUID(), lineId: line.id, kind: 'timed', units: values.map((v, j) => ({ id: crypto.randomUUID(), text: v, beginUs: line.words[j].beginUs, endUs: line.words[j].endUs })) });
          else track.contents.push({ id: crypto.randomUUID(), lineId: line.id, kind: 'plain', text: values.join('') });
        });
        if (track.contents.length) d.romanizationTracks.push(track);
      }
    }
  }
  return d;
}
export async function decodeKrcFile(file: File): Promise<string> {
  const raw = new Uint8Array(await file.arrayBuffer());
  if (new TextDecoder().decode(raw.slice(0, 4)) !== 'krc1') throw new Error('KRC 文件头无效');
  const key = [64,71,97,119,94,50,116,71,81,54,49,45,206,210,110,105];
  const bytes = raw.slice(4).map((v, i) => v ^ key[i % 16]);
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate')).getReader();
  let total = 0, result = ''; const decoder = new TextDecoder('utf-8', { fatal: true });
  try { while (true) { const { value, done } = await reader.read(); if (done) break; total += value.length; if (total > 4_000_000) throw new Error('KRC 解压超过 4 MB'); result += decoder.decode(value, { stream: true }); } return result + decoder.decode(); }
  finally { await reader.cancel(); }
}
export function parseLrcSource(text: string): LyricDocument {
  const d = createLyricDocument(); d.lines = [];
  const offset = Number(text.match(/^\[offset:([+-]?\d+)\]/m)?.[1] ?? 0);
  const clock = (a: string, b: string) => time(Number(a) * 60000 + Number(b) * 1000 + offset);
  for (const raw of text.split(/\r?\n/)) {
    const heads = [...raw.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
    if (!heads.length) continue;
    const body = raw.slice(heads.at(-1)!.index! + heads.at(-1)![0].length);
    for (const h of heads) {
      const line = createLine(''); line.beginUs = clock(h[1], h[2]);
      let begin = line.beginUs, pos = 0;
      for (const marker of body.matchAll(/<(\d+):(\d+(?:\.\d+)?)>/g)) {
        const end = clock(marker[1], marker[2]); if (end < begin) throw new Error('扩展 LRC 词时间倒序');
        const value = body.slice(pos, marker.index); if (value) line.words.push({ ...createWord(value), beginUs: begin, endUs: end });
        begin = end; pos = marker.index! + marker[0].length;
      }
      if (body.slice(pos)) line.words.push({ ...createWord(body.slice(pos)), beginUs: begin, endUs: null });
      // Empty events are format boundaries, not editable lyric lines.
      if (!body) { const prev = d.lines.at(-1); if (prev && prev.endUs === null) prev.endUs = line.beginUs; continue; }
      if (pos === body.length) line.endUs = begin;
      d.lines.push(line);
    }
  }
  if (!d.lines.length) throw new Error('未解析出 LRC 歌词');
  return d;
}
export function attachSidecar(d: LyricDocument, text: string, kind: 'translation' | 'romanization'): string[] {
  if (!text) return [];
  const timed = /^\[\d+,\d+\].*\(\d+,\d+\)/m.test(text);
  const side = timed ? parseWordFormat(text, 'qrc') : parseLrcSource(text), issues: string[] = [];
  const track: RomanizationTrack = { id: crypto.randomUUID(), language: null, contents: [] };
  for (const line of side.lines) {
    const matches = d.lines.filter(main => main.beginUs === line.beginUs);
    if (matches.length !== 1) { issues.push(`附属歌词 ${line.beginUs! / 1000000}s 无唯一对应主行：${lineText(line)}`); continue; }
    const main = matches[0];
    if (kind === 'translation') main.translations.push({ language: null, text: lineText(line) });
    else track.contents.push(timed ? { id: crypto.randomUUID(), lineId: main.id, kind: 'timed', units: line.words.map(w => ({ id: crypto.randomUUID(), text: w.text, beginUs: w.beginUs, endUs: w.endUs })) } : { id: crypto.randomUUID(), lineId: main.id, kind: 'plain', text: lineText(line) });
  }
  if (track.contents.length) d.romanizationTracks.push(track);
  return issues;
}
