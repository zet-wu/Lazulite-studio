import {useTranslation} from 'react-i18next';
import type {LyricAgent, LyricWord} from '../../domain/lyric-document';
import type {LyricCommand} from '../../domain/lyric-commands';
import {BooleanField} from '../../shared/Controls';
import {AgentMembership} from './SingerSelection';

export function WordProperties({words, agents, noWordAgents, apply}: {
  words: {lineId:string; word:LyricWord}[]; agents:LyricAgent[]; noWordAgents?:boolean; apply:(command:LyricCommand)=>boolean;
}) {
  const {t}=useTranslation();
  if (!words.length) return null;
  return <>
    <BooleanField label={t('editor.explicit')} checked={words.every(({word})=>word.obscene)}
      mixed={words.some(({word})=>word.obscene) && !words.every(({word})=>word.obscene)} onChange={obscene=>{
        const changed=words.filter(({word})=>word.obscene!==obscene);
        if(changed.length)apply({type:'batch',commands:changed.map(({lineId,word})=>({type:'set-word-obscene',lineId,wordId:word.id,obscene}))});
      }}/>
    {!noWordAgents && <AgentMembership agents={agents} references={words.map(({word})=>word.agentRefs??[])} label={t('editor.wordSinger')} namedLabel={name=>t('editor.wordSingerLabel',{name})}
      change={(agentId,checked)=>{
        const changed=words.filter(({word})=>(word.agentRefs?.includes(agentId)??false)!==checked);
        if(changed.length)apply({type:'batch',commands:changed.map(({lineId,word})=>({type:'set-word-agents',lineId,wordId:word.id,
          agentRefs:checked?[...(word.agentRefs??[]),agentId]:(word.agentRefs??[]).filter(id=>id!==agentId)}))});
      }}/>}</>;
}
