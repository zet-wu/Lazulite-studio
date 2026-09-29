/** Synthetic Phase 5 review behaviors, including untimed XML whitespace and empty transliteration. */
export const phase6Ttml = () => `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" xmlns:itunes="http://music.apple.com/lyric-ttml-internal">
<head><metadata><ttm:agent xml:id="v1" type="person"><ttm:name>主唱</ttm:name></ttm:agent><ttm:agent xml:id="v2" type="person"><ttm:name>另一歌手</ttm:name></ttm:agent>
<iTunesMetadata xmlns="http://music.apple.com/lyric-ttml-internal"><transliterations>
<transliteration xml:lang="en"><text for="english"><span begin="1" end="2">ai</span><span begin="0" end="6"></span><span begin="0" end="6">  </span></text><text for="english">alternate</text><text for="cjk"><span begin="6" end="8">uta</span></text></transliteration>
<transliteration xml:lang="ja"><text for="english">ai</text></transliteration>
</transliterations></iTunesMetadata></metadata></head>
<body><div><p xml:id="english" begin="1" end="5" ttm:agent="v1 v2"><span begin="1" end="2">I</span> <span begin="2" end="3">still</span> <span begin="3" end="4">love</span> <span begin="4" end="5">you</span><span ttm:role="x-translation" xml:lang="en">song</span><span ttm:role="x-translation" xml:lang="zh-Hans">译文</span></p>
<p xml:id="cjk" begin="6" end="8" ttm:agent="v2"><span begin="6" end="8">中文 é</span></p>
<p xml:id="empty" begin="9" end="10"><span begin="9" end="10">背景候选</span><span ttm:role="x-translation">删除我</span></p>
</div></body></tt>`;
