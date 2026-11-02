import { useMessageText } from '../shared/useMessageText';
import { message as describeMessage, errorMessage } from '../domain/messages';
import { i18n } from '../i18n';
import { useTranslation } from 'react-i18next';
import {useEffect,useMemo,useState} from 'react';
import {amllLabels,amllDependencies,checkAmll,ruleCount,type AmllRule,type AmllResults} from '../domain/amll-compatibility';
import type {ProjectDocument,ProjectCommand} from '../domain/project-document';
import type {OutputIssue} from '../adapters/output-validation';
import {BooleanField} from '../shared/Controls';
import {SettingsDialog} from './editor/SettingsDialog';
import {Branch,LineGroups} from './OutputIssues';
import styles from './editor/semantic-editor.module.css';
export function AmllSettings({project,apply,locate}:{project:ProjectDocument;apply:(command:ProjectCommand)=>void;locate:(rule:AmllRule)=>void}) {
  useTranslation();
 const results=useMemo(()=>checkAmll(project.lyrics),[project.lyrics]);
 return <section aria-label={t('amll.settings')}>{(Object.keys(amllLabels) as AmllRule[]).map(rule=>{
   const locked=project.amll.simplified&&amllDependencies.includes(rule), conflict=!project.amll[rule]&&ruleCount(results,rule)>0;
   return <div key={rule}><BooleanField label={t(amllLabels[rule])} switchControl checked={project.amll[rule]} disabled={locked||conflict} onChange={enabled=>apply({type:'amll-setting',rule,enabled})}/>
     {locked&&<small>{t('amll.locked')}</small>}{conflict&&<><small>{t('amll.conflict')}</small><button data-role="inline" onClick={()=>locate(rule)}>{t('amll.locate')}</button></>}
   </div>;
 })}</section>;
}
function Simplify({project,apply,close,error}:{project:ProjectDocument;error:string;apply:(command:ProjectCommand)=>boolean;close:()=>void}) {
  useTranslation();
 const [selected,setSelected]=useState<string[]>(()=>project.lyrics.agents.filter((_,i)=>i%2===1).map(agent=>agent.id));
 return <SettingsDialog title={t('amll.simplify')} close={close} actions={<><button data-role="secondary" onClick={close}>{t('common.cancel')}</button><button data-role="primary" onClick={()=>{if(apply({type:'amll-batch',rule:'simplified',duetAgents:selected}))close();}}>{t('common.convert')}</button></>}>
 {error&&<p role="alert">{error}</p>}
 <p>{t('amll.simplifyHelp')}</p>
 <fieldset className={styles.singerSelection}><legend>{t('amll.duetSingers')}</legend>
 {project.lyrics.agents.map(agent=><label key={agent.id}><input type="checkbox" checked={selected.includes(agent.id)} onChange={()=>setSelected(ids=>ids.includes(agent.id)?ids.filter(id=>id!==agent.id):[...ids,agent.id])}/>{agent.name??agent.id}</label>)}
 </fieldset>
 </SettingsDialog>;
}
const actions:Record<AmllRule,string>={simplified:'amll.simplify',noMultipleBackgrounds:'amll.keepFirstBackground',noChorus:'amll.keepFirstSinger',noWordAgents:'amll.clearWordSingers',noIndependentBackground:'amll.clearBackgroundSingers'};
export function AmllPanel({project,results,current,apply,locate,focusRule,onRuleLocated}:{project:ProjectDocument;results:AmllResults;current:boolean;apply:(command:ProjectCommand)=>void;locate:(issue:OutputIssue)=>void;focusRule?:AmllRule;onRuleLocated?:()=>void}) {
  useTranslation();
 const [error,setError]=useMessageText(''),[mapping,setMapping]=useState<ProjectDocument|null>(null);
 const [expanded,setExpanded]=useState<Partial<Record<AmllRule,boolean>>>({});
 useEffect(()=>{setMapping(null);},[project,current]);
 useEffect(()=>{
   if(!current||!focusRule)return;
   setExpanded(prev=>({...prev,[focusRule]:true}));
   const frame=requestAnimationFrame(()=>{
     const target=document.querySelector<HTMLElement>(`#amll-${focusRule} button[aria-expanded]`);
     target?.focus();target?.scrollIntoView({block:'nearest'});onRuleLocated?.();
   });
   return ()=>cancelAnimationFrame(frame);
 },[current,focusRule,onRuleLocated]);
 const [selected,setSelected]=useState<Partial<Record<AmllRule,string[]>>>({});
 const [previous,setPrevious]=useState(results);
 if(previous!==results) {
   setPrevious(results);
   setSelected(prev=>Object.fromEntries(Object.entries(prev).map(([rule,ids])=>[rule,ids.filter(id=>results[rule as AmllRule].some(issue=>issue.id===id))])));
 }
 const execute=(command:ProjectCommand)=>{if(!current) return false; try{apply(command);setError('');return true;}catch(e){setError(errorMessage(e));return false;}};
 return <section aria-label={t('validation.amll')}>
 {error&&<p role="alert">{error}</p>}
 {(Object.keys(amllLabels) as AmllRule[]).map(rule=>{
  const issues:OutputIssue[]=results[rule].map(item=>({kind:item.wordId?'word':item.agentId?'agent':'line',lineId:item.lineId??'',wordId:item.wordId,agentId:item.agentId,missing:[],message:item.message,detail:item.detail}));
  const ids=selected[rule]??[];const count=ruleCount(results,rule), lost=selected[rule]!==undefined&&!ids.length;
  const run=(all=false)=>{if(rule==='simplified')setMapping(project);else execute({type:'amll-batch',rule,ids:all?[]:ids});};
  return <div key={rule} id={`amll-${rule}`}><Branch open={expanded[rule]??false} onOpenChange={open=>setExpanded(prev=>({...prev,[rule]:open}))} title={t('amll.ruleStatus',{rule:t(amllLabels[rule]),status:t(count?'amll.unmet':'amll.met')})}>
   {()=> <><p>{t(rule==='simplified'?'amll.singerCount':rule==='noMultipleBackgrounds'?'amll.mainGroupCount':rule==='noWordAgents'?'amll.wordCount':rule==='noIndependentBackground'?'amll.backgroundCount':'amll.objectCount',{count:issues.length,lines:new Set(issues.map(i=>i.lineId)).size})}</p>
    {rule==='simplified'&&amllDependencies.map(key=>results[key].length>0&&<p key={key}>{t('amll.dependency',{rule:t(amllLabels[key]),count:results[key].length})} <a href={`#amll-${key}`}>{t('amll.rules')}</a></p>)}
    {(count>0||lost)&&<><p>{t('amll.scope',{scope:rule==='simplified'?t('amll.projectScope'):lost?t('amll.selectionGone'):ids.length?t('amll.selectedCount',{count:ids.length}):t('amll.allRuleObjects')})}</p>
      <button data-role="secondary" disabled={!current||lost||!count} onClick={()=>run()}>{rule==='simplified'?t(actions[rule]):t(selected[rule]!==undefined?'amll.applySelected':'amll.applyAll',{action:t(actions[rule]),count:selected[rule]!==undefined?ids.length:count})}</button>
      {selected[rule]!==undefined&&count>0&&<button data-role="secondary" disabled={!current} onClick={()=>run(true)}>{t('amll.processAll',{count})}</button>}
    </>}
    {rule!=='simplified'&&<LineGroups issues={issues} keys={new Set()} locate={locate} document={project.lyrics} selection={{ids,toggle:id=>setSelected(prev=>{
      const next=ids.includes(id)?ids.filter(item=>item!==id):[...ids,id];
      const updated={...prev,[rule]:next}; if(!next.length)delete updated[rule]; return updated;
    })}}/>}
   </>}
  </Branch></div>;
 })}
 {mapping===project&&current&&<Simplify error={error} project={project} close={()=>setMapping(null)} apply={execute}/>}
 </section>;
}

const t=i18n.t.bind(i18n);
