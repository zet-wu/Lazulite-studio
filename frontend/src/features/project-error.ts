import type { ProjectDocument } from '../domain/project-document';
/** Translate known project references only at the user-facing error boundary. */
export function projectErrorText(project: ProjectDocument, message: string): string {
  const identity = /[\w-]*[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
  if (!identity.test(message)) return message;
  identity.lastIndex = 0;
  const labels = new Map<string,string>();
  for (const [i,line] of project.lyrics.lines.entries()) {
    const label = `第 ${i+1} 行${line.backgroundOf?'（背景）':''}`;
    labels.set(line.id,label);
    line.words.forEach((word,j)=>{
      labels.set(word.id,`${label}第 ${j+1} 词「${word.text}」`);
      word.rubyUnits.forEach((ruby,k)=>labels.set(ruby.id,`${label}第 ${j+1} 词第 ${k+1} 注音「${ruby.reading}」`));
    });
  }
  for (const [kind,tracks] of [['翻译',project.lyrics.translationTracks],['音译',project.lyrics.romanizationTracks]] as const) tracks.forEach((track,i)=>{
    const label=`${kind}轨道 ${i+1} · ${track.language||'und'}`;labels.set(track.id,label);
    track.contents.forEach((content,j)=>{
      const owner=labels.get(content.lineId)??'已失效行';
      labels.set(content.id,`${owner} · ${label} · 内容 ${j+1}`);
      if(content.kind==='timed')content.units.forEach((unit,k)=>labels.set(unit.id,`${owner} · ${label} · 内容 ${j+1} 第 ${k+1} 单元`));
    });
  });
  project.karaoke.cues.forEach(cue=>labels.set(cue.id,`${labels.get(cue.anchor.lineId)??'已失效行'} · 导唱「${cue.text}」`));
  project.acoustics.segments.forEach((segment,i)=>labels.set(segment.id,`人声片段 ${i+1}`));
  // UUID-shaped references are generated identities, unlike editable singer/group IDs.
  return message.replace(identity,id=>labels.get(id)??id);
}
