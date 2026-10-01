import { expect, it } from 'vitest';
import { parseLyricTtml, serializeLyricTtml } from '../src/adapters/ttml/lyric-codec';
import { parseTTML } from '@applemusic-like-lyrics/lyric';
const xml = (body: string) => `<tt xmlns="http://www.w3.org/ns/ttml"><body>${body}</body></tt>`;
it('quantizes high precision, carries minutes/hours and is accepted by the external parser', () => {
 for (const [input, expected, clock] of [['18.084263',18084,'00:18.084'],['18.084500',18085,'00:18.085'],['59.9995',60000,'01:00.000'],['3599.9995',3600000,'01:00:00.000']] as const) {
  const document = parseLyricTtml(xml(`<p begin="${input}" end="3601"><span begin="${input}" end="3601">歌</span></p>`));
  expect(document.lines[0].beginMs).toBe(expected);
  const output = serializeLyricTtml(document);
  expect(output).toContain(`begin="${clock}"`);
  expect(parseLyricTtml(output).lines[0].words[0].beginMs).toBe(expected);
  expect(parseTTML(output).lines[0].words[0].startTime).toBe(expected);
 }
});
it('resolves relative ancestors once, preserves collapsed and null endpoints, rejects raw inversion', () => {
 const document = parseLyricTtml(xml('<div begin="0.0004s"><p begin="0.0004s" end="0.0005s"><span begin="0s" end="0.0001s">歌</span></p></div>'));
 expect(document.lines[0]).toMatchObject({beginMs:1,endMs:1});
 expect(document.lines[0].words[0]).toMatchObject({beginMs:1,endMs:1});
 expect(parseLyricTtml(xml('<p>歌</p>')).lines[0].beginMs).toBeNull();
 expect(()=>parseLyricTtml(xml('<p begin="0.00049" end="0.00048">歌</p>'))).toThrow('precedes');
 expect(()=>parseLyricTtml(xml('<p begin="-0.0001" end="1">歌</p>'))).toThrow();
});
