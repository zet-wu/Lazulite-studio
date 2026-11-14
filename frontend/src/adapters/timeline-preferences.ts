import {usePreference} from './studio-preferences';
export const timelineLayers = {
  line:'selection.line', word:'selection.word', ruby:'selection.ruby', romanization:'media.romanization', gap:'media.gaps',
  karaoke:'media.countIn', wave:'media.waveform', spectrum:'media.spectrogram', energy:'media.energy', segments:'media.segments', staging:'timeline.staging',
} as const;
export type TimelineLayer = keyof typeof timelineLayers;
export const defaultTimelineVisibility: Record<TimelineLayer,boolean> = {line:true,word:true,ruby:true,romanization:true,gap:true,karaoke:true,wave:true,spectrum:false,energy:true,segments:true,staging:true};
export function useTimelineVisibility() {
  const [raw,save]=usePreference('studio:timeline-layers',JSON.stringify(defaultTimelineVisibility));
  const visible:Record<TimelineLayer,boolean>={...defaultTimelineVisibility,...JSON.parse(raw)};
  return [visible,(layer:TimelineLayer,value:boolean)=>save(JSON.stringify({...visible,[layer]:value}))] as const;
}
export const useStagingIgnoredCharacters = () => usePreference('studio:staging-ignored-characters',' ');
