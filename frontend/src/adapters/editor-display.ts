import {savePreference} from './preferences';
export type EditorDisplay = 'simple'|'advanced';
export function changeEditorDisplay(value:EditorDisplay) {
  const event=new CustomEvent('studio-editor-display-request',{cancelable:true,detail:value});
  if(window.dispatchEvent(event))void savePreference('studio:editor-display',value).catch(()=>undefined);
}
