import { isUntimedSeparator } from './export-separators';
import { defaultSingerMarker, singerKey, singerSet, markerProblem, type SingerMarker } from '../domain/singer-markers';
import transparentPng from '../assets/transparent-1x1.png?inline';
import { cueProblem, cueWord, outputId, type KaraokeCue } from '../domain/karaoke';
import type { LyricLine, LyricWord, TimeMs } from '../domain/lyric-document';
import type { ProjectDocument } from '../domain/project-document';
import { DocumentOutputError, outputIssueKey, type OutputIssue } from './output-validation';

export type KaraokeOutput = { id: string; groupId: string; kind: 'body' | 'translation' | 'romanization'; trackId: string; language: string; label: string };
export function karaokeOutputs(project: ProjectDocument): KaraokeOutput[] {
  return project.karaoke.groups.flatMap(group => [
    { id: outputId(group.id), groupId: group.id, kind: 'body' as const, trackId: '', language: '', label: `${group.name} · 正文` },
    ...(['translation', 'romanization'] as const).flatMap(kind => project.lyrics[kind === 'translation' ? 'translationTracks' : 'romanizationTracks'].map(track => ({ id: outputId(group.id, kind, track.id), groupId: group.id, kind, trackId: track.id, language: track.language || 'und', label: `${group.name} · ${kind === 'translation' ? '翻译' : '音译'} · ${track.language || 'und'} · ${track.id}` }))),
  ]);
}
export const quantize = (ms: number) => Math.floor(ms / 10) * 10;
export function nicokaraTime(ms: number) {
  const cs = Math.floor(ms / 10);
  return `[${String(Math.floor(cs / 6000)).padStart(2, '0')}:${String(Math.floor(cs / 100) % 60).padStart(2, '0')}:${String(cs % 100).padStart(2, '0')}]`;
}
// Numeric references are decoded by the consumer after field/tag recognition.
export const encodeKraText = (text: string, ruby = false) => text.replace(ruby ? /[&,\[\]【】]/g : /[&\[\]【】]/g, char => `&#${char.codePointAt(0)};`);
export const safeFilename = (name: string) => {
  const clean = name.normalize('NFC').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/\.{2,}/g, '_').replace(/[. ]+$/g, '').slice(0, 100) || 'project';
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(clean) ? `_${clean}` : clean;
};
const encodeEmojiField = (text: string) => text.replace(/[&,\[\]]/g, char => `&#${char.codePointAt(0)};`);
function emojiDeclaration(marker: SingerMarker, index: number) {
  return `@Emoji${index}=` + [encodeEmojiField(marker.trigger), encodeEmojiField(marker.beforeImage), encodeEmojiField(marker.afterImage), marker.sizeMode==='Zoom'?`Zoom=${marker.zoom}`:'Fix', ...(marker.noDecor?['NoDecor']:marker.forceWipeDecor?['ForceWipeDecor']:[]), ...([['marginLeft','MarginLeft'],['marginRight','MarginRight'],['marginBottom','MarginBottom']] as const).flatMap(([key,name])=>marker[key]?[`${name}=${marker[key]}`]:[])].join(',');
}
type SegmentSinger = { key: string; marker: SingerMarker; target: Partial<OutputIssue> };
type Segment = { text: string; beginMs: number; endMs: number; singer?: SegmentSinger };
function sequence(segments: Segment[], offset = 0, singer?: { key: string; emit: (value: SegmentSinger) => void }) {
  let result = '', last: number | null = null;
  for (const segment of segments) {
    const begin = quantize(segment.beginMs) - offset, end = quantize(segment.endMs) - offset;
    if (last !== begin) result += nicokaraTime(begin);
    if (singer && segment.singer && segment.singer.key !== singer.key) {
      result += encodeEmojiField(segment.singer.marker.trigger);
      singer.emit(segment.singer);
      singer.key = segment.singer.key;
    }
    result += segment.text + nicokaraTime(end); last = end;
  }
  return result;
}
export function prepareNicokara(project: ProjectDocument, title: string, selected = project.karaoke.outputs) {
  const issues: OutputIssue[] = [], files: { name: string; text: string; output: KaraokeOutput }[] = [], omitted: string[] = [];
  const outputs = karaokeOutputs(project), lyrics = project.lyrics, karaoke = project.karaoke;
  const add = (target: Partial<OutputIssue>, message: string, output: string, code: OutputIssue['code'] = 'serialization') => issues.push({ kind: 'line', lineId: '', missing: [], ...target, code, message, severity: 'error', formats: ['Nicokara'], outputIds: [output] });
  const valid = (begin: TimeMs, end: TimeMs, target: Partial<OutputIssue>, output: string) => {
    if (begin === null || end === null) { add({...target,missing:[...(begin===null?['begin' as const]:[]),...(end===null?['end' as const]:[])]}, '缺少完整双端时间', output, 'missing-time'); return false; }
    if (!Number.isSafeInteger(begin) || !Number.isSafeInteger(end) || begin < 0 || end <= begin || quantize(end) > 5999990) { add(target, '时间必须为正范围，且不超过 [99:59:99]', output, 'invalid-range'); return false; }
    if (quantize(begin) === quantize(end)) { add(target, '有文字单元在厘秒量化后变为零时长', output, 'invalid-range'); return false; }
    return true;
  };
  const textOk = (text: string, target: Partial<OutputIssue>, output: string) => {
    if (/[\r\n\t\u0000-\u0008\u000b\u000c\u000e-\u001f\u2028\u2029]/u.test(text)) add(target, '此字段的控制字符或换行无法忠实写入 Nicokara 单行', output);
  };
  const metadata = Object.entries({ title: 'Title', artist: 'Artist', album: 'Album', composer: 'Compose', lyricist: 'Lyrics' }).flatMap(([key, tag]) => {
    const value = lyrics.metadata[key]?.join(' / ').replace(/[\r\n\u2028\u2029]+/g, ' ');
    return value ? [`@${tag}=${encodeKraText(value)}`] : [];
  });
  const stems = new Map(outputs.map(output=>{
    const same=outputs.filter(o=>o.groupId===output.groupId&&o.kind===output.kind&&o.language===output.language);
    const suffix=output.kind==='body'?'':`.${output.kind}.${safeFilename(output.language)}${same.length>1?`.${safeFilename(output.trackId)}`:''}`;
    return [output.id,`${safeFilename(title)}.${safeFilename(output.groupId)}${suffix}`.slice(0,220)];
  }));
  const names=new Map<string,string>(),usedNames=new Set<string>();
  for(const output of [...outputs].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0)){
    const stem=stems.get(output.id)!;let name=`${stem}.kra`,index=1;
    while(usedNames.has(name.toLowerCase()))name=`${stem}.${index++}.kra`;
    usedNames.add(name.toLowerCase());names.set(output.id,name);
  }
  for (const id of [...new Set(selected)]) {
    const output = outputs.find(output => output.id === id);
    if (!output) { add({ karaokeSettings: true }, '所选输出已失效，请重新选择文件', id); continue; }
    const lines = lyrics.lines.filter(line => karaoke.lineGroups[line.id] === output.groupId);
    const rows: string[] = [], rules: string[] = [], bases: { word: LyricWord; lineId: string; signature: string; begin: number; end: number }[] = [];
    const declarations = new Map<string, SegmentSinger>();
    const singer = { key: '[]', emit: (value: SegmentSinger) => declarations.set(value.key, value) };
    const singerFor = (line: LyricLine, word: LyricWord): SegmentSinger | undefined => {
      const value = singerSet(lyrics, line, word), target = { kind: 'word' as const, lineId: line.id, wordId: word.id };
      if (value.missing) add(target, '歌手引用已失效', id);
      if (!value.ids.length) return undefined;
      const marker = karaoke.singerMarkers.find(marker=>singerKey(marker.agentIds)===value.key) ?? defaultSingerMarker(value);
      return { key: value.key, marker, target };
    };
    const cueSegment = (cue: KaraokeCue): Segment | null => {
      const target = { lineId: cue.anchor.lineId, cueId: cue.id }, problem = cueProblem(lyrics, karaoke, cue);
      if (problem) add(target, problem, id, 'invalid-range');
      if (!valid(cue.beginMs, cue.endMs, target, id)) return null;
      textOk(cue.text, target, id);
      const line = lyrics.lines.find(line => line.id === cue.anchor.lineId), word = cueWord(lyrics, cue);
      return { text: encodeKraText(cue.text, cue.anchor.kind === 'ruby'), beginMs: cue.beginMs, endMs: cue.endMs, singer: line && word ? singerFor(line, word) : undefined };
    };
    for (const line of lines) {
      if (output.kind !== 'body') {
        const track = lyrics[output.kind === 'translation' ? 'translationTracks' : 'romanizationTracks'].find(track => track.id === output.trackId)!;
        for (const content of track.contents.filter(content => content.lineId === line.id)) {
          const target = { kind: `${output.kind}-content` as OutputIssue['kind'], lineId: line.id, trackId: track.id, contentId: content.id };
          const text = content.kind === 'plain' ? content.text : content.units.map(unit => unit.text).join('');
          if (!text.length) continue;
          let begin = line.beginMs, end = line.endMs;
          if (content.kind === 'timed') {
            const units = content.units.filter(unit => unit.text.length);
            if (units.some(unit => !valid(unit.beginMs, unit.endMs, { ...target, unitId: unit.id, kind: `${output.kind}-unit` as OutputIssue['kind'] }, id))) continue;
            begin = Math.min(...units.map(unit => unit.beginMs!)); end = Math.max(...units.map(unit => unit.endMs!));
          }
          textOk(text, target, id);
          if (valid(begin, end, target, id)) rows.push(`${nicokaraTime(begin!)}${encodeKraText(text)}${nicokaraTime(end!)}`);
        }
        continue;
      }
      const segments: Segment[] = [];
      const before = karaoke.cues.filter(cue => cue.anchor.kind === 'before' && cue.anchor.lineId === line.id).sort((a, b) => a.beginMs - b.beginMs);
      for (const cue of before) { const s = cueSegment(cue); if (s) segments.push(s); }
      let leadingSpace = '';
      for (const word of line.words) {
        if (isUntimedSeparator(word, project.editing)) { if (segments.length) segments.at(-1)!.text += word.text; else leadingSpace += word.text; continue; }
        const target = { kind: 'word' as const, lineId: line.id, wordId: word.id };
        if (!word.text.length) continue;
        textOk(word.text, target, id);
        if (!valid(word.beginMs, word.endMs, target, id)) continue;
        const currentSinger = singerFor(line, word);
        segments.push({ text: encodeKraText(leadingSpace + word.text), beginMs: word.beginMs!, endMs: word.endMs!, singer: currentSinger });
        leadingSpace = '';
        const reading: Segment[] = [];
        for (const unit of word.rubyUnits) {
          const rubyTarget = { ...target, kind: 'ruby' as const, rubyId: unit.id };
          textOk(unit.reading, rubyTarget, id);
          if (!valid(unit.beginMs, unit.endMs, rubyTarget, id)) continue;
          if (unit.beginMs! < word.beginMs! || unit.endMs! > word.endMs! || reading.length && unit.beginMs! < reading.at(-1)!.endMs) add(rubyTarget, 'Ruby 重叠、倒序或超出正文范围', id, 'invalid-range');
          reading.push({ text: encodeKraText(unit.reading, true), beginMs: unit.beginMs!, endMs: unit.endMs! });
          for (const cue of karaoke.cues.filter(cue => cue.anchor.kind === 'ruby' && cue.anchor.wordId === word.id && cue.anchor.leftId === unit.id)) { const s = cueSegment(cue); if (s) reading.push(s); }
        }
        if (word.rubyUnits.length) {
          let encoded = sequence(reading, quantize(word.beginMs!));
          if (encoded.startsWith('[00:00:00]')) encoded = encoded.slice(10);
          // The explicit base range closes trailing silence; keep the last reading end tag.
          const rule = `@Ruby${rules.length + 1}=${encodeKraText(word.text, true)},${encoded},${nicokaraTime(word.beginMs!)},${nicokaraTime(word.endMs!)}`;
          if (rule.length > 1024) add(target, 'Ruby 字段超过规范单行 1024 字符限制', id);
          rules.push(rule); bases.push({ word, lineId: line.id, signature: encoded, begin: quantize(word.beginMs!), end: quantize(word.endMs!) });
        }
        for (const cue of karaoke.cues.filter(cue => cue.anchor.kind === 'word' && cue.anchor.lineId === line.id && cue.anchor.leftId === word.id)) { const s = cueSegment(cue); if (s) segments.push(s); }
      }
      if (leadingSpace) add({lineId:line.id}, '空白没有可承载的有效正文时间', id, 'missing-time');
      if (segments.length) rows.push(sequence(segments, 0, singer));
    }
    if (output.kind === 'body') {
      for (const cue of karaoke.cues.filter(cue => karaoke.lineGroups[cue.anchor.lineId] === output.groupId)) {
        const problem = cueProblem(lyrics, karaoke, cue); if (problem) add({ lineId: cue.anchor.lineId, cueId: cue.id }, problem, id, 'invalid-range');
      }
      for (const {marker,target,key} of declarations.values()) {
        const problem=markerProblem(marker); if(problem)add(target,problem,id);
        for(const field of [marker.trigger,marker.beforeImage,marker.afterImage])textOk(field,target,id);
        for(const other of declarations.values())if(other.key!==key && (marker.trigger.includes(other.marker.trigger)||other.marker.trigger.includes(marker.trigger)))add(target,'不同歌手集合的触发标记相同或相互包含，请在歌手标记管理中消歧',id);
        if(marker.trigger && lines.some(line=>line.words.map(word=>word.text).join('').includes(marker.trigger) || line.words.some(word=>word.rubyUnits.map(unit=>unit.reading).join('').includes(marker.trigger))) || marker.trigger && karaoke.cues.some(cue=>karaoke.lineGroups[cue.anchor.lineId]===output.groupId&&cue.text.includes(marker.trigger)))add(target,'触发标记与实际歌词或导唱冲突，请在歌手标记管理中修改',id);
        if(emojiDeclaration(marker, declarations.size).length>1024)add(target,'歌手声明超过规范单行 1024 字符限制',id);
      }
      for (const base of bases) for (const line of lines) {
        const joined=line.words.map(word=>word.text).join('');
        for(let at=joined.indexOf(base.word.text);at>=0;at=joined.indexOf(base.word.text,at+1)){
          let offset=0;
          const word=line.words.find(word=>{const contains=offset<=at&&offset+word.text.length>at;offset+=word.text.length;return contains;});
          if(!word||word.beginMs===null)continue;
          const exact=word.text===base.word.text;
          if(exact&&word.id===base.word.id)continue;
          const time=quantize(word.beginMs),match=bases.find(b=>b.word.id===word.id);
          if(time<base.begin||time>base.end||exact&&match?.signature===base.signature)continue;
          for(const item of [{lineId:base.lineId,wordId:base.word.id},{lineId:line.id,wordId:word.id}])add({kind:'word',...item},'Ruby 规则会匹配同文或子串的另一对象，请调整输出分组',id);
        }
      }
    }
    for (const tag of metadata) if (tag.length > 1024) add({ karaokeSettings: true }, '元数据超过规范单行 1024 字符限制', id);
    if (!rows.length) { omitted.push(output.label); continue; }
    const name = names.get(output.id)!;
    files.push({ name, text: '\uFEFF' + [...metadata, ...rows, ...rules, ...[...declarations.values()].map((value,index)=>emojiDeclaration(value.marker,index+1))].join('\r\n') + '\r\n', output });
  }
  // Invalid assignments cannot silently drop lyrics from an otherwise selected output.
  for (const line of lyrics.lines) if (!karaoke.groups.some(group => group.id === karaoke.lineGroups[line.id]) && selected.length) add({ lineId: line.id, karaokeSettings: true }, '歌词行缺少有效输出分组', selected[0]);
  if (!selected.length || !files.length && !issues.length) add({ karaokeSettings: true }, '请选择至少一个有实际内容的输出文件', selected[0] ?? '');
  const merged = new Map<string, OutputIssue>();
  for (const issue of issues) { const key = outputIssueKey(issue) + issue.message; const previous = merged.get(key); merged.set(key, previous ? { ...previous, outputIds: [...new Set([...previous.outputIds!, ...issue.outputIds!])] } : issue); }
  return { files, issues: [...merged.values()], omitted, summary: [...files.map(file => `${file.name} — ${file.output.label}`), ...omitted.map(label => `空输出已省略：${label}`), '时间向下量化为厘秒；源项目毫秒时间不变。', '翻译／音译按整句输出；请在 NKM3 中将扫色前后颜色设为相同以显示静态字幕。', '歌手标记写入输出副本；未指定歌手时沿用已输出声部。'].join('\r\n') + '\r\n' };
}
/** Uncompressed ZIP writer with UTF-8 names and CRC32. */
export function zipFiles(files: ({ name: string; text: string } | { name: string; data: Uint8Array<ArrayBuffer> })[]): Uint8Array<ArrayBuffer> {
  const enc = new TextEncoder(), local: Uint8Array<ArrayBuffer>[] = [], central: Uint8Array<ArrayBuffer>[] = []; let offset = 0;
  for (const file of files) {
    const name = enc.encode(file.name), data = 'data' in file ? file.data : enc.encode(file.text); let crc = 0xffffffff;
    for (const byte of data) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); } crc = (crc ^ 0xffffffff) >>> 0;
    const header = new Uint8Array(30 + name.length), view = new DataView(header.buffer);
    view.setUint32(0, 0x04034b50, true); view.setUint16(4, 20, true); view.setUint16(6, 0x800, true); view.setUint16(12, 33, true);
    view.setUint32(14, crc, true); view.setUint32(18, data.length, true); view.setUint32(22, data.length, true); view.setUint16(26, name.length, true); header.set(name, 30);
    const directory = new Uint8Array(46 + name.length), d = new DataView(directory.buffer);
    d.setUint32(0, 0x02014b50, true); d.setUint16(4, 20, true); d.setUint16(6, 20, true); d.setUint16(8, 0x800, true); d.setUint16(14, 33, true);
    d.setUint32(16, crc, true); d.setUint32(20, data.length, true); d.setUint32(24, data.length, true); d.setUint16(28, name.length, true); d.setUint32(42, offset, true); directory.set(name, 46);
    local.push(header, data); central.push(directory); offset += header.length + data.length;
  }
  const size = central.reduce((n, part) => n + part.length, 0), end = new Uint8Array(22), e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, size, true); e.setUint32(16, offset, true);
  const result = new Uint8Array(offset + size + 22); let at = 0;
  for (const part of [...local, ...central, end]) { result.set(part, at); at += part.length; } return result;
}
export function nicokaraZip(project: ProjectDocument, title: string) {
  const result = prepareNicokara(project, title);
  if (result.issues.length) throw new DocumentOutputError(result.issues);
  const image = Uint8Array.from(atob(transparentPng.split(',')[1]), char=>char.charCodeAt(0));
  return zipFiles([...result.files, { name: 'summary.txt', text: '\uFEFF' + result.summary }, { name: 'transparent-1x1.png', data: image }]);
}
