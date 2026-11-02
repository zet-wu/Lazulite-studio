import {i18n,formatMessage} from '../i18n';
import type {OutputIssue} from '../adapters/output-validation';
import type {LyricDocument} from '../domain/lyric-document';
export function issueLocation(issue:OutputIssue,document?:LyricDocument):string {
 const t=i18n.t.bind(i18n);
 if(issue.agentId)return t('singer.nameLabel',{id:issue.agentId});
 if(issue.karaokeSettings)return t('validation.karaokeSettings');
 if(issue.segmentId)return t('validation.acoustics');
 const line=document?.lines.find(line=>line.id===issue.lineId);
 if(!line)return issue.lineId?t('editor.lineLabel',{number:issue.lineId}):t(issue.code==='serialization'?'validation.unlocated':'validation.project');
 const parts=[t('validation.locationLine',{number:document!.lines.filter(l=>!l.backgroundOf).findIndex(l=>l.id===(line.backgroundOf??line.id))+1,background:line.backgroundOf?' · '+t('outline.background'):''})];
 const word=line.words.find(w=>w.id===issue.wordId);
 if(word)parts.push(t('validation.locationWord',{number:line.words.indexOf(word)+1}));
 if(word&&issue.rubyId)parts.push(t('validation.locationRuby',{number:word.rubyUnits.findIndex(r=>r.id===issue.rubyId)+1}));
 if(issue.trackId){
  const tracks=issue.kind.startsWith('translation')?document!.translationTracks:document!.romanizationTracks;
  const track=tracks.find(t=>t.id===issue.trackId),content=track?.contents.find(c=>c.id===issue.contentId);
  parts.push(t(issue.kind.startsWith('translation')?'selection.translation':'selection.romanization'));
  if(track)parts.push(track.language??t('editor.unspecifiedLanguage'));
  if(content?.kind==='timed'&&issue.unitId)parts.push(t('validation.locationUnit',{number:content.units.findIndex(u=>u.id===issue.unitId)+1}));
 }
 return parts.join(' · ');
}
export function issueText(issue:OutputIssue,document?:LyricDocument):string {
 return issue.detail?`${issueLocation(issue,document)}: ${formatMessage(issue.detail)}`:issue.message;
}

export function karaokeOutputLabel(output: import('../adapters/karaoke-output').KaraokeOutput, project: import('../domain/project-document').ProjectDocument):string {
 return i18n.t(`output.${output.kind}Label`,{group:project.karaoke.groups.find(group=>group.id===output.groupId)?.name??output.groupId,number:output.trackNumber,language:output.language});
}
