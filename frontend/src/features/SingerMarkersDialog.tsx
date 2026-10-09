import { useState } from 'react';
import { initializeSingerMarkers, singerKey, usedSingerSets, type SingerMarker } from '../domain/singer-markers';
import type { KaraokeCommand } from '../domain/karaoke';
import type { ProjectDocument } from '../domain/project-document';
import { SettingsDialog } from './editor/SettingsDialog';
import { Select } from '../shared/Select';
import styles from './karaoke.module.css';

export function SingerMarkersDialog({project,close,apply,error}:{project:ProjectDocument;close:()=>void;apply:(command:KaraokeCommand)=>boolean;error:string}) {
  const sets=usedSingerSets(project.lyrics);
  const [markers,setMarkers]=useState(()=>initializeSingerMarkers(project.lyrics,project.karaoke.singerMarkers));
  const [selected,setSelected]=useState(sets[0]?.key);
  const marker=markers.find(marker=>singerKey(marker.agentIds)===selected);
  const update=(patch:Partial<SingerMarker>)=>setMarkers(markers.map(item=>item===marker?{...item,...patch}:item));
  return <SettingsDialog title="歌手标记管理" close={close}>
    {error&&<p role="alert">{error}</p>}
    <div className={styles.markerEditor}>
      <div className={styles.markerList} aria-label="歌手及合唱组合">{sets.map(set=><button key={set.key} data-role="secondary" aria-pressed={set.key===selected} onClick={()=>setSelected(set.key)}>{set.label}</button>)}</div>
      {marker?<div className={styles.markerFields}>
        <strong>{sets.find(set=>set.key===selected)?.label}</strong>
        {([['trigger','触发标记'],['beforeImage','扫色前图片'],['afterImage','扫色后图片']] as const).map(([key,label])=><label key={key}>{label}<input value={marker[key]} onChange={event=>update({[key]:event.target.value})}/></label>)}
        <label>图片尺寸模式<Select value={marker.sizeMode} onChange={event=>update({sizeMode:event.target.value as SingerMarker['sizeMode']})}><option value="Zoom">Zoom</option><option value="Fix">Fix</option></Select></label>
        {marker.sizeMode==='Zoom'&&<label>Zoom 值<input value={marker.zoom} onChange={event=>update({zoom:event.target.value})}/></label>}
        <label><input type="checkbox" checked={marker.noDecor} onChange={event=>update({noDecor:event.target.checked})}/>不添加文字装饰</label>
        <label><input type="checkbox" disabled={marker.noDecor} checked={marker.forceWipeDecor&&!marker.noDecor} onChange={event=>update({forceWipeDecor:event.target.checked})}/>强制装饰扫色</label>
        {([['marginLeft','左边距'],['marginRight','右边距'],['marginBottom','底部边距']] as const).map(([key,label])=><label key={key}>{label}<input type="number" step={1} value={Number.isNaN(marker[key])?'':marker[key]} onChange={event=>update({[key]:event.target.value===''?NaN:Number(event.target.value)})}/></label>)}
      </div>:<p>当前歌词没有指定歌手。</p>}
    </div>
    <button data-role="primary" onClick={()=>{if(apply({kind:'singer-markers',markers}))close();}}>应用</button>
  </SettingsDialog>;
}
