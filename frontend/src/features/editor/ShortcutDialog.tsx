import {useTranslation} from 'react-i18next';
import {useState} from 'react';
import {useSyncStyle} from '../../adapters/sync-style';
import {bindingError,captureBinding,defaultBindings,formatBinding,saveBindings,shortcutActions,useShortcuts,type ShortcutAction} from '../shortcuts';
import {SettingsPanel} from './SettingsDialog';
import {IconButton} from '../../shared/Controls';
import fields from '../../shared/settings-fields.module.css';
import styles from './shortcut-dialog.module.css';

export function ShortcutDialog({close,embedded}:{close:()=>void;embedded?:boolean}) {
 const {t}=useTranslation();
 const bindings=useShortcuts();
 const [style]=useSyncStyle();
 const actionLabel=(action:ShortcutAction)=>t(style==='sug'&&action==='next'?'sync.singleKey':shortcutActions[action][1]);
 const [error,setError]=useState<{action:ShortcutAction;message:NonNullable<ReturnType<typeof bindingError>>}|null>(null);
 const actions=(Object.keys(shortcutActions) as ShortcutAction[]).filter(action=>style!=='sug'||action!=='start'&&action!=='end');
 const groups=[...new Set(actions.map(action=>shortcutActions[action][0]))];
 const save=(action:ShortcutAction,binding:typeof bindings[ShortcutAction])=>{
   const reason=bindingError(action,binding,bindings);setError(reason?{action,message:reason}:null);
   if(!reason)saveBindings({...bindings,[action]:binding});
 };
 return <SettingsPanel hideTitle={embedded} embedded={embedded} title={t('shortcuts.title')} close={close} actions={<button data-role="secondary" onClick={()=>{saveBindings(defaultBindings);setError(null);}}>{t('shortcuts.restore')}</button>}>
   <p>{t('shortcuts.help')}</p>
   {groups.map(group=><fieldset className={fields.group} key={group}><legend>{t(group)}</legend>
     {actions.filter(action=>shortcutActions[action][0]===group).map(action=>{
       const problem=error?.action===action?error.message:null;
       const errorId=`shortcut-error-${action}`;
       return <div key={action}><div className={styles.row}>
         <label htmlFor={`shortcut-${action}`}>{actionLabel(action)}</label>
         <input id={`shortcut-${action}`} aria-label={t('shortcuts.input',{action:actionLabel(action)})} aria-invalid={!!problem} aria-describedby={problem?errorId:undefined} readOnly value={formatBinding(bindings[action])} onKeyDown={event=>{
           if(event.key==='Tab'||event.key==='Escape')return;
           event.preventDefault();event.stopPropagation();
           if(event.nativeEvent.isComposing||/^(Control|Meta|Alt|Shift)/.test(event.code))return;
           save(action,captureBinding(event.nativeEvent));
         }}/>
         <IconButton icon="refresh" label={t('shortcuts.resetOne',{action:actionLabel(action)})} onClick={()=>save(action,defaultBindings[action])}/>
       </div>{problem&&<p id={errorId} className={fields.error} role="alert">{problem.key==='shortcuts.conflict'?t(problem.key,{action:t(String(problem.values?.actionKey))}):t(problem.key)}</p>}</div>;
     })}
   </fieldset>)}
 </SettingsPanel>;
}
