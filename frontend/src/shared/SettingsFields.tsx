import {useId, type ReactNode, type ComponentProps} from 'react';
import {BooleanField} from './Controls';
import styles from './settings-fields.module.css';

/** A single setting; wrapping labels preserve native input association. */
export function SettingField({label, description, error, errorId, stacked=false, children}: {label:string; description?:ReactNode; error?:string; errorId?:string; stacked?:boolean; children:ReactNode}) {
  return <div className={styles.field}><label className={`${styles.row} ${stacked?styles.stacked:''}`}>
    <span className={styles.caption}>{label}{description&&<small>{description}</small>}</span>
    <span className={styles.control}>{children}</span>
  </label>{error&&<p id={errorId} className={styles.error} role="alert">{error}</p>}</div>;
}
export function SettingToggle({description, ...props}: Omit<ComponentProps<typeof BooleanField>, 'mixed'|'switchControl'|'className'|'descriptionId'> & {description?:string}) {
  const id=useId();
  return <BooleanField {...props} switchControl className={styles.toggle} description={description} descriptionId={id}/>;
}
