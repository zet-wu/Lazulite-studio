export function largeKana(rows = 2000, words = 10) {
  return `<tt xmlns="http://www.w3.org/ns/ttml"><body><div>${Array.from({ length: rows }, (_, i) => `<p xml:id="k${i}" begin="${i}" end="${i + 1}">${Array.from({ length: words }, () => `<span begin="${i}" end="${i + 1}">か</span>`).join('')}</p>`).join('')}</div></body></tt>`;
}
export function longRuby(units = 512) {
  return `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:tts="http://www.w3.org/ns/ttml#styling"><body><div><p xml:id="long" begin="0" end="${units}"><span begin="0" end="${units}" tts:ruby="container"><span tts:ruby="base">長い正文</span><span tts:ruby="textContainer">${Array.from({ length: units }, (_, i) => `<span tts:ruby="text" begin="${i}" end="${i + 1}">か</span>`).join('')}</span></span></p></div></body></tt>`;
}
