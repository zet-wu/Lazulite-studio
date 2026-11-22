import { useEffect, useRef, type ButtonHTMLAttributes } from 'react';
import { Icon } from './Icon';
export function IconButton({ icon, label, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { icon: Parameters<typeof Icon>[0]['name']; label: string }) {
 return <button type="button" data-role="inline" {...props} className={`icon-button ${props.className ?? ''}`} aria-label={label} data-tooltip={label}><Icon name={icon}/></button>;
}
export function BooleanField({ label, ariaLabel, checked, mixed = false, switchControl = false, disabled = false, className = '', description, descriptionId, onChange }: { className?: string; description?: string; descriptionId?: string; label: string; ariaLabel?: string; checked: boolean; mixed?: boolean; switchControl?: boolean; disabled?: boolean; onChange: (checked: boolean) => void }) {
 const ref = useRef<HTMLInputElement>(null);
 useEffect(() => { if (ref.current) ref.current.indeterminate = mixed; }, [mixed]);
 return <label className={`boolean-field ${className}`}><input ref={ref} aria-label={ariaLabel ?? (description ? label : undefined)} aria-describedby={description ? descriptionId : undefined} disabled={disabled} type="checkbox" role={switchControl ? 'switch' : undefined} checked={checked} aria-checked={mixed ? 'mixed' : checked} onChange={() => onChange(mixed || !checked)}/><span>{label}{description&&<small id={descriptionId}>{description}</small>}</span></label>;
}
