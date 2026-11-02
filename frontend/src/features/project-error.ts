import { i18n } from '../i18n';
import type { ProjectDocument } from '../domain/project-document';
/** Translate known project references only at the user-facing error boundary. */
export function projectErrorText(project: ProjectDocument, message: string): string {
  const t=i18n.t.bind(i18n);
  const identity = /[\w-]*[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
  if (!identity.test(message)) return message;
  identity.lastIndex = 0;
  const labels = new Map<string,string>();
  for (const [i,line] of project.lyrics.lines.entries()) {
    const label = t('project.errorLine',{number:i+1,background:line.backgroundOf?' ('+t('editor.background')+')':''});
    labels.set(line.id,label);
    line.words.forEach((word,j)=>{
      labels.set(word.id,t('project.errorWord',{line:label,number:j+1,text:word.text}));
      word.rubyUnits.forEach((ruby,k)=>labels.set(ruby.id,t('project.errorRuby',{line:label,word:j+1,number:k+1,text:ruby.reading})));
    });
  }
  for (const [kind,tracks] of [[t('selection.translation'),project.lyrics.translationTracks],[t('selection.romanization'),project.lyrics.romanizationTracks]] as const) tracks.forEach((track,i)=>{
    const label=t('project.errorTrack',{kind,number:i+1,language:track.language||'und'});labels.set(track.id,label);
    track.contents.forEach((content,j)=>{
      const owner=labels.get(content.lineId)??t('project.staleLine');
      labels.set(content.id,t('project.errorContent',{line:owner,track:label,number:j+1}));
      if(content.kind==='timed')content.units.forEach((unit,k)=>labels.set(unit.id,t('project.errorUnit',{line:owner,track:label,content:j+1,number:k+1})));
    });
  });
  project.karaoke.cues.forEach(cue=>labels.set(cue.id,t('project.errorCue',{line:labels.get(cue.anchor.lineId)??t('project.staleLine'),text:cue.text})));
  project.acoustics.segments.forEach((segment,i)=>labels.set(segment.id,t('project.errorSegment',{number:i+1})));
  // UUID-shaped references are generated identities, unlike editable singer/group IDs.
  return message.replace(identity,id=>labels.get(id)??id);
}
