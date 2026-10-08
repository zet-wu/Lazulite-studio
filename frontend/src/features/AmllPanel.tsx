import {useEffect,useRef,useState} from 'react';
import {amllLabels,amllDependencies,checkAmll,ruleCount,type AmllRule} from '../domain/amll-compatibility';
import type {ProjectDocument,ProjectCommand} from '../domain/project-document';
import type {OutputIssue} from '../adapters/output-validation';
import {BooleanField} from '../shared/Controls';
import {SettingsDialog} from './editor/SettingsDialog';
import {Branch,LineGroups} from './OutputIssues';
export function AmllSettings({project,apply,locate}:{project:ProjectDocument;apply:(command:ProjectCommand)=>void;locate:()=>void}) {
 const results=checkAmll(project.lyrics);
 return <section aria-label="AMLL 项目设置">{(Object.keys(amllLabels) as AmllRule[]).map(rule=>{
   const locked=project.amll.simplified&&amllDependencies.includes(rule), conflict=!project.amll[rule]&&ruleCount(results,rule)>0;
   return <div key={rule}><BooleanField label={amllLabels[rule]} switchControl checked={project.amll[rule]} disabled={locked||conflict} onChange={enabled=>apply({type:'amll-setting',rule,enabled})}/>
     {locked&&<small>由简化歌手模型锁定</small>}{conflict&&<><small>当前内容不满足此限制</small><button data-role="inline" onClick={locate}>定位兼容问题</button></>}
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
export function AmllPanel({project,apply,locate}:{project:ProjectDocument;apply:(command:ProjectCommand)=>void;locate:(issue:OutputIssue)=>void}) {
 const [checked,setChecked]=useState<ProjectDocument|null>(null),[error,setError]=useState(''),[mapping,setMapping]=useState(false);
 const [selected,setSelected]=useState<Partial<Record<AmllRule,string[]>>>({});const refresh=useRef(false);
 useEffect(()=>{if(refresh.current){setChecked(project);setSelected({});refresh.current=false;}},[project]);
 const current=checked===project;const results=checked?checkAmll(checked.lyrics):null;
 const execute=(command:ProjectCommand)=>{try{apply(command);refresh.current=true;setError('');}catch(e){setError(e instanceof Error?e.message:'处理失败');throw e;}};
 return <section aria-label="AMLL 兼容校验"><button data-role="primary" onClick={()=>{setChecked(project);setSelected({});setError('');}}>AMLL 兼容校验</button>
 <p>仅检查本轮五项约束，不代表外部工具无损或投稿通过。</p>
 {checked&&!current&&<p role="status">项目内容或设置已变化，请重新校验；旧结果不能执行批量处理。</p>}
 {error&&<p role="alert">{error}</p>}
 {results&&(Object.keys(amllLabels) as AmllRule[]).map(rule=>{
  const issues:OutputIssue[]=results[rule].map(item=>({kind:item.wordId?'word':item.agentId?'agent':'line',lineId:item.lineId??'',wordId:item.wordId,agentId:item.agentId,missing:[],message:item.message}));
  const ids=selected[rule]??[];const count=ruleCount(results,rule);
  return <div key={rule} id={`amll-${rule}`}><Branch title={`${amllLabels[rule]}：${count?'不满足':'满足'} · 设置${project.amll[rule]?'开启':'关闭'}`}>
   {()=> <><p>{rule==='noMultipleBackgrounds'?`${issues.length} 个主行组`:rule==='noWordAgents'?`${issues.length} 个词，涉及 ${new Set(issues.map(i=>i.lineId)).size} 行`:rule==='noIndependentBackground'?`${issues.length} 条背景行`:`${issues.length} 个对象`}</p>
    {rule==='simplified'&&amllDependencies.map(key=>results[key].length>0&&<p key={key}>依赖 {amllLabels[key]}：{results[key].length} 个对象 <a href={`#amll-${key}`}>查看规则组</a></p>)}
    {count>0&&<><p>范围：{rule==='simplified'?'全项目':ids.length?`选中 ${ids.length} 项`:'该规则全部问题对象'}</p><button data-role="secondary" disabled={!current} onClick={()=>{if(rule==='simplified')setMapping(true);else {try{execute({type:'amll-batch',rule,ids});}catch{/* rendered above */}}}}>{actions[rule]}</button></>}
    <LineGroups issues={issues} keys={new Set()} locate={locate} document={checked!.lyrics} selection={rule==='simplified'?undefined:{ids,toggle:id=>setSelected(prev=>({...prev,[rule]:ids.includes(id)?ids.filter(item=>item!==id):[...ids,id]}))}}/>
   </>}
  </Branch></div>;
 })}
 {mapping&&<Simplify key={JSON.stringify(project.lyrics.agents)} error={error} project={project} close={()=>setMapping(false)} apply={command=>{try{execute(command);return true;}catch{return false;}}}/>}
 </section>;
}
