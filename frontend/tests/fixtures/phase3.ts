/** Synthetic lyrics only; exact overlap, touching endpoints and non-integer times. */
export function timelineTtml(count = 4) {
  const ranges = [[1.123, 5.985], [1.123, 5.985], [3.123, 7.985], [7.985, 9.123]];
  return `<tt xmlns="http://www.w3.org/ns/ttml"><body><div>${Array.from({ length: count }, (_, i) => {
    const [begin, end] = ranges[i % ranges.length];
    return `<p xml:id="p3-${i}" begin="${begin}s" end="${end}s"><span begin="0s" end="${(end - begin).toFixed(6)}s">合成歌词${i}${'长正文'.repeat(30)}</span></p>`;
  }).join('')}</div></body></tt>`;
}
export function listText(count: number) {
  return Array.from({ length: count }, (_, i) => `合成行${i} ${'变高文本 '.repeat(i % 7 + 1)}`).join('\n');
}

export function overlapTtml() {
  const ranges = [[2.123, 4.985], [2.123, 4.985], [3.123, 6.985], [6.985, 8.123]];
  return `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:tts="http://www.w3.org/ns/ttml#styling"><body><div>${Array.from({ length: 4 }, (_, i) => `<p xml:id="overlap-${i}" begin="1.123" end="10.985">${ranges.map(([begin, end], j) => `<span tts:ruby="container" begin="${begin}" end="${end}"><span tts:ruby="base">词${j}</span><span tts:ruby="textContainer"><span tts:ruby="text" begin="${begin}" end="${end}">读${j}</span></span></span>`).join('')}</p>`).join('')}</div></body></tt>`;
}
