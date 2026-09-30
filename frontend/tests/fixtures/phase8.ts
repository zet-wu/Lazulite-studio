export function largeKana(rows = 2000, words = 10) {
  return `<tt xmlns="http://www.w3.org/ns/ttml"><body><div>${Array.from({ length: rows }, (_, i) => `<p xml:id="k${i}" begin="${i}" end="${i + 1}">${Array.from({ length: words }, () => `<span begin="${i}" end="${i + 1}">か</span>`).join('')}</p>`).join('')}</div></body></tt>`;
}
export function longRuby(units = 512) {
  return `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:tts="http://www.w3.org/ns/ttml#styling"><body><div><p xml:id="long" begin="0" end="${units}"><span begin="0" end="${units}" tts:ruby="container"><span tts:ruby="base">長い正文</span><span tts:ruby="textContainer">${Array.from({ length: units }, (_, i) => `<span tts:ruby="text" begin="${i}" end="${i + 1}">か</span>`).join('')}</span></span></p></div></body></tt>`;
}

export const mixedRubyKana = `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:tts="http://www.w3.org/ns/ttml#styling"><body><div><p xml:id="mixed" begin="0" end="9">
<span begin="0" end="2" tts:ruby="container"><span tts:ruby="base">粉</span><span tts:ruby="textContainer"><span tts:ruby="text" begin="0" end="1">こ</span><span tts:ruby="text" begin="1" end="2">な</span></span></span>
<span begin="2" end="4" tts:ruby="container"><span tts:ruby="base">雪</span><span tts:ruby="textContainer"><span tts:ruby="text" begin="2" end="3">ゆ</span><span tts:ruby="text" begin="3" end="4">き</span></span></span>
<span begin="4" end="5">が</span>
<span begin="5" end="7" tts:ruby="container"><span tts:ruby="base">空</span><span tts:ruby="textContainer"><span tts:ruby="text" begin="5" end="6">そ</span><span tts:ruby="text" begin="6" end="7">ら</span></span></span>
<span begin="7" end="8">か</span><span begin="8" end="9">ら</span>
</p></div></body></tt>`;
