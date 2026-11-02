/** Serializable UI message identity. Domain rules never resolve a current language. */
export type Message = { key:string; values?:Record<string,string|number>; parts?: Message[] };
export function message(key:string,values?:Message['values']):Message {return {key,values};}
export function isMessage(value:unknown):value is Message {return !!value && typeof value==='object' && 'key' in value && typeof value.key==='string';}

export class MessageError extends Error {
  constructor(readonly detail: Message) { super(detail.key); this.name='MessageError'; }
}
export function errorMessage(error: unknown): Message {
  return error instanceof MessageError ? error.detail : message('error.unexpected', {diagnostic: error instanceof Error ? error.message : String(error)});
}

export function messageList(parts:Message[]):Message { return {key:'notice.list',parts}; }
