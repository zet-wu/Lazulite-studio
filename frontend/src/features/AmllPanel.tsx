import {useEffect,useMemo,useState} from 'react';
import {amllLabels,amllDependencies,checkAmll,ruleCount,type AmllRule,type AmllResults} from '../domain/amll-compatibility';
import type {ProjectDocument,ProjectCommand} from '../domain/project-document';
import type {OutputIssue} from '../adapters/output-validation';
import {BooleanField} from '../shared/Controls';
import {SettingsDialog} from './editor/SettingsDialog';
import {Branch,LineGroups} from './OutputIssues';
export function AmllSettings({project,apply,locate}:{project:ProjectDocument;apply:(command:ProjectCommand)=>void;locate:(rule:AmllRule)=>void}) {
 const results=useMemo(()=>checkAmll(project.lyrics),[project.lyrics]);
 return <section aria-label="AMLL 项目设置">{(Object.keys(amllLabels) as AmllRule[]).map(rule=>{
   const locked=project.amll.simplified&&amllDependencies.includes(rule), conflict=!project.amll[rule]&&ruleCount(results,rule)>0;
   return <div key={rule}><BooleanField label={amllLabels[rule]} switchControl checked={project.amll[rule]} disabled={locked||conflict} onChange={enabled=>apply({type:'amll-setting',rule,enabled})}/>
     {locked&&<small>由简化歌手模型锁定</small>}{conflict&&<><small>当前内容不满足此限制</small><button data-role="inline" onClick={()=>locate(rule)}>定位兼容问题</button></>}
   </div>;
 })}</section>;
}
function Simplify({project,apply,close,error}:{project:ProjectDocument;error:string;apply:(command:ProjectCommand)=>boolean;close:()=>void}) {
 const [selected,setSelected]=useState<string[]>(()=>project.lyrics.agents.filter((_,i)=>i%2===1).map(agent=>agent.id));
 return <SettingsDialog title="转换为简化歌手模型" close={close} actions={<><button data-role="secondary" onClick={close}>取消</button><button data-role="primary" onClick={()=>{if(apply({type:'amll-batch',rule:'simplified',duetAgents:selected}))close();}}>转换</button></>}>
 {error&&<p role="alert">{error}</p>}
 <p>选中歌手归对唱侧，其余归默认侧。全项目清除自定义身份、词级及背景独立歌手；主行按引用首项映射。</p>
 {project.lyrics.agents.map(agent=><label key={agent.id}><input type="checkbox" checked={selected.includes(agent.id)} onChange={()=>setSelected(ids=>ids.includes(agent.id)?ids.filter(id=>id!==agent.id):[...ids,agent.id])}/>{agent.name??agent.id}</label>)}
 </SettingsDialog>;
}
const actions:Record<AmllRule,string>={simplified:'转换为简化歌手模型',noMultipleBackgrounds:'保留首条背景，其余转主行',noChorus:'保留引用首位歌手',noWordAgents:'清除词级歌手',noIndependentBackground:'清除背景行及其词的歌手'};
export function AmllPanel({project,results,current,apply,locate,focusRule,onRuleLocated}:{project:ProjectDocument;results:AmllResults;current:boolean;apply:(command:ProjectCommand)=>void;locate:(issue:OutputIssue)=>void;focusRule?:AmllRule;onRuleLocated?:()=>void}) {
 const [error,setError]=useState(''),[mapping,setMapping]=useState<ProjectDocument|null>(null);
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
 const execute=(command:ProjectCommand)=>{if(!current) return false; try{apply(command);setError('');return true;}catch(e){setError(e instanceof Error?e.message:'处理失败');return false;}};
 return <section aria-label="AMLL 兼容校验">
 <p>仅检查本轮五项约束，不代表外部工具无损或投稿通过。</p>
 {error&&<p role="alert">{error}</p>}
 {(Object.keys(amllLabels) as AmllRule[]).map(rule=>{
  const issues:OutputIssue[]=results[rule].map(item=>({kind:item.wordId?'word':item.agentId?'agent':'line',lineId:item.lineId??'',wordId:item.wordId,agentId:item.agentId,missing:[],message:item.message}));
  const ids=selected[rule]??[];const count=ruleCount(results,rule), lost=selected[rule]!==undefined&&!ids.length;
  const run=(all=false)=>{if(rule==='simplified')setMapping(project);else execute({type:'amll-batch',rule,ids:all?[]:ids});};
  return <div key={rule} id={`amll-${rule}`}><Branch open={expanded[rule]??false} onOpenChange={open=>setExpanded(prev=>({...prev,[rule]:open}))} title={`${amllLabels[rule]}：${count?'不满足':'满足'} · 设置${project.amll[rule]?'开启':'关闭'}`}>
   {()=> <><p>{rule==='noMultipleBackgrounds'?`${issues.length} 个主行组`:rule==='noWordAgents'?`${issues.length} 个词，涉及 ${new Set(issues.map(i=>i.lineId)).size} 行`:rule==='noIndependentBackground'?`${issues.length} 条背景行`:`${issues.length} 个对象`}</p>
    {rule==='simplified'&&amllDependencies.map(key=>results[key].length>0&&<p key={key}>依赖 {amllLabels[key]}：{results[key].length} 个对象 <a href={`#amll-${key}`}>查看规则组</a></p>)}
    {(count>0||lost)&&<><p>范围：{rule==='simplified'?'全项目':lost?'原选中问题已消失':ids.length?`选中 ${ids.length} 项`:'该规则全部问题对象'}</p>
      <button data-role="secondary" disabled={!current||lost||!count} onClick={()=>run()}>{actions[rule]}{rule!=='simplified'&&(selected[rule]!==undefined?`（处理选中 ${ids.length} 项）`:`（处理全部 ${count} 项）`)}</button>
      {selected[rule]!==undefined&&count>0&&<button data-role="secondary" disabled={!current} onClick={()=>run(true)}>处理全部 {count} 项</button>}
    </>}
    <LineGroups issues={issues} keys={new Set()} locate={locate} document={project.lyrics} selection={rule==='simplified'?undefined:{ids,toggle:id=>setSelected(prev=>{
      const next=ids.includes(id)?ids.filter(item=>item!==id):[...ids,id];
      const updated={...prev,[rule]:next}; if(!next.length)delete updated[rule]; return updated;
    })}}/>
   </>}
  </Branch></div>;
 })}
 {mapping===project&&current&&<Simplify error={error} project={project} close={()=>setMapping(null)} apply={execute}/>}
 </section>;
}
