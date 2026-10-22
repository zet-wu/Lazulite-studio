import { outputId } from '../domain/karaoke';
import type { ProjectDocument } from '../domain/project-document';
export type KaraokeOutput = { id: string; groupId: string; kind: 'body' | 'translation' | 'romanization'; trackId: string; trackNumber: number; language: string; label: string };
export function karaokeOutputs(project: ProjectDocument): KaraokeOutput[] {
  return project.karaoke.groups.flatMap(group => [
    { id: outputId(group.id), groupId: group.id, kind: 'body' as const, trackId: '', trackNumber: 0, language: '', label: `${group.name} · 正文` },
    ...(['translation', 'romanization'] as const).flatMap(kind => project.lyrics[kind === 'translation' ? 'translationTracks' : 'romanizationTracks'].map((track,index) => ({ id: outputId(group.id, kind, track.id), groupId: group.id, kind, trackId: track.id, trackNumber: index + 1, language: track.language || 'und', label: `${group.name} · ${kind === 'translation' ? '翻译' : '音译'} ${index + 1} · ${track.language || 'und'}` }))),
  ]);
}
export const safeFilename = (name: string) => {
  const clean = name.normalize('NFC').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/\.{2,}/g, '_').replace(/[. ]+$/g, '').slice(0, 100) || 'project';
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(clean) ? `_${clean}` : clean;
};
export function karaokeFilenames(outputs: KaraokeOutput[], title: string, extension: string) {
  const stems = new Map(outputs.map(output=>{
    const same=outputs.filter(o=>o.groupId===output.groupId&&o.kind===output.kind&&o.language===output.language);
    const suffix=output.kind==='body'?'':`.${output.kind}.${safeFilename(output.language)}${same.length>1?`.track${output.trackNumber}`:''}`;
    return [output.id,`${safeFilename(title)}.${safeFilename(output.groupId)}${suffix}`.slice(0,220)];
  }));
  const names=new Map<string,string>(),usedNames=new Set<string>();
  for(const output of [...outputs].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0)){
    const stem=stems.get(output.id)!;let name=`${stem}.${extension}`,index=1;
    while(usedNames.has(name.toLowerCase()))name=`${stem}.${index++}.${extension}`;
    usedNames.add(name.toLowerCase());names.set(output.id,name);
  }
  return names;
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
