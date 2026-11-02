/** Serializable UI message identity. Domain rules never resolve a current language. */
export type Message = { key:string; values?:Record<string,string|number> };
export function message(key:string,values?:Message['values']):Message {return {key,values};}
export function isMessage(value:unknown):value is Message {return !!value && typeof value==='object' && 'key' in value && typeof value.key==='string';}
