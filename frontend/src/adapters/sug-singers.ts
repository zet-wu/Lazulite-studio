import { cueWord } from '../domain/karaoke';
import { singerKey, singerSet } from '../domain/singer-markers';
import type { LyricLine, LyricWord } from '../domain/lyric-document';
import type { ProjectDocument } from '../domain/project-document';
import { karaokeOutputs, type KaraokeOutput } from './karaoke-output';

type Project = Pick<ProjectDocument, 'lyrics' | 'karaoke'>;
export function sugSingerSet(project: Project, line: LyricLine, word?: LyricWord) {
  const set = singerSet(project.lyrics, line, word ?? { agentRefs: undefined } as LyricWord);
  return { ...set, label: set.ids.map(id => {
    const index = project.lyrics.agents.findIndex(agent => agent.id === id);
    return project.lyrics.agents[index].name || `歌手 ${index + 1}`;
  }).join('+') || '未指定' };
}
/** Content and membership are independent of timing validity and download selection. */
export function sugOutputContent(project: Project, output: KaraokeOutput) {
  return project.lyrics.lines.filter(line => project.karaoke.lineGroups[line.id] === output.groupId).map(line => ({
    line,
    words: line.words.filter(word => word.text.length),
    cues: project.karaoke.cues.filter(cue => cue.anchor.lineId === line.id && cue.text.length),
    contents: output.kind === 'body' ? [] : project.lyrics[output.kind === 'translation' ? 'translationTracks' : 'romanizationTracks'].find(track => track.id === output.trackId)!.contents.filter(content => content.lineId === line.id && (content.kind === 'plain' ? content.text.length : content.units.some(unit => unit.text.length))),
  }));
}
export function sugSingerOptions(project: Project) {
  return karaokeOutputs(project).map(output => {
    const sets = sugOutputContent(project, output).flatMap(({line, words, cues, contents}) => output.kind === 'body'
      ? [...words.map(word => sugSingerSet(project, line, word)), ...cues.map(cue => sugSingerSet(project, line, cueWord(project.lyrics, cue)))]
      : contents.length ? [sugSingerSet(project, line)] : []);
    return { output, sets: [...new Map(sets.map(set => [set.key, set])).values()] };
  }).filter(item => item.sets.length);
}
export function sugSingerName(project: Project, output: KaraokeOutput, set: ReturnType<typeof sugSingerSet>) {
  return project.karaoke.sugSingerNames?.find(item => item.outputId === output.id && singerKey(item.agentIds) === set.key)?.name
    ?? `${set.label}${output.groupId === 'main' ? '' : `.${output.groupId}`}${output.kind === 'body' ? '' : `.${output.language}`}`;
}
