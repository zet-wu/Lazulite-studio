import { useEffect, useRef, useState } from 'react';
import './management-table.css';

// Inputs stay mounted and commit without blurring on Enter. Escape is local.
export function TableField({ value, label, commit, cancel, autoFocus, multiline = false, list, commitInitial = false }: { value: string; label: string; commit: (value: string) => boolean | void; cancel?: () => void; autoFocus?: boolean; multiline?: boolean; list?: string; commitInitial?: boolean }) {
 const [draft,setDraft] = useState(value);
 const initialPending = useRef(commitInitial);
 const last = useRef(value), composing = useRef(false);
 const [compositionActive, setCompositionActive] = useState(false);
 useEffect(() => { last.current=value; setDraft(value); },[value]);
 const submit = () => { if (!composing.current && (initialPending.current || draft !== last.current) && commit(draft) !== false) { last.current=draft; initialPending.current=false; } };
 const props = { 'data-uncommitted': draft !== value || compositionActive || undefined, 'aria-label':label, value:draft, autoFocus, onChange:(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>)=>setDraft(e.target.value), onBlur:submit,
 onCompositionStart:()=>{composing.current=true;setCompositionActive(true);}, onCompositionEnd:()=>{composing.current=false;setCompositionActive(false);}, onKeyDown:(e: React.KeyboardEvent)=>{
  if (composing.current || e.nativeEvent.isComposing) { if (e.key==='Escape') e.stopPropagation(); return; }
  if(e.key==='Enter' && !e.shiftKey) { e.preventDefault();e.stopPropagation();submit(); }
  if(e.key==='Escape') { e.preventDefault();e.stopPropagation();setDraft(last.current);cancel?.(); }
 }};
 return multiline ? <textarea rows={1} {...props}/> : <input list={list} {...props}/>;
}
