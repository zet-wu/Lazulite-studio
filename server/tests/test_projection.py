from server.projection import project_ttml


def test_projection_excludes_ruby_and_non_ttml_paragraphs(tmp_path):
    source = tmp_path / "sample.ttml"
    source.write_text('''<tt xmlns="http://www.w3.org/ns/ttml" xmlns:tts="http://www.w3.org/ns/ttml#styling" xmlns:ext="urn:ext" xmlns:tt="urn:other"><head><metadata><p xml:id="meta">bad</p></metadata></head><body><div><p xml:id="line"><span>前</span><span tts:ruby="container"><span tts:ruby="base">今日</span><span tts:ruby="text">きょう</span></span><br/>後</p><p>无 id</p><ext:p xml:id="x">bad</ext:p><ext:wrapper><p xml:id="bad">bad</p></ext:wrapper></div><tt:p xml:id="bad2">bad</tt:p></body></tt>''', encoding="utf-8")
    assert project_ttml(source) == [{"id": "line", "text": "前今日\n後"}, {"id": "line-1-0-1", "text": "无 id"}]
