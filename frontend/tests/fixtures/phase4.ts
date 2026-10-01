/** Synthetic text with independent line/word/注音 intervals; no commercial lyrics. */
export const phase4Ttml = () => `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:tts="http://www.w3.org/ns/ttml#styling"><body><div>
<p xml:id="ordinary" begin="1" end="3"><span tts:ruby="container" begin="1" end="3"><span tts:ruby="base">普通</span><span tts:ruby="textContainer"><span tts:ruby="text" begin="1" end="3">ふつう</span></span></span></p>
<p xml:id="narrow" begin="2" end="2.001"><span tts:ruby="container" begin="2" end="2.001"><span tts:ruby="base">窄</span><span tts:ruby="textContainer"><span tts:ruby="text" begin="2" end="2.001">せまい</span></span></span></p>
<p xml:id="overlap" begin="2" end="4"><span begin="2" end="4">重叠</span></p>
</div></body></tt>`;
export const backgroundTtml = (parentBegin = 1, parentEnd = 2, begin = 2, end = 5) =>
  `<tt xmlns="http://www.w3.org/ns/ttml"><body><div><p xml:id="parent" begin="${parentBegin}" end="${parentEnd}"><span begin="${parentBegin}" end="${parentEnd}">主行</span></p><p xml:id="background" begin="${begin}" end="${end}"><span begin="${begin}" end="${Math.min(end, begin + 2)}">背景测试</span></p></div></body></tt>`;
export const rubyTtml = () => `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:itunes="http://music.apple.com/lyric-ttml-internal"><head><metadata><iTunesMetadata xmlns="http://music.apple.com/lyric-ttml-internal"><transliterations><transliteration xml:lang="ja-Latn"><text for="kana"><span begin="1" end="1.5">ga</span><span begin="1.5" end="2">na</span><span begin="2" end="3">ka</span></text></transliteration></transliterations></iTunesMetadata></metadata></head><body><div><p xml:id="kana" begin="1" end="3"><span begin="1" end="2">がな</span><span begin="2" end="3">か</span></p></div></body></tt>`;
