declare module 'opencc-js/t2cn' {
  export function Converter(options: { from: string; to: 'cn' }): (value: string) => string;
}
