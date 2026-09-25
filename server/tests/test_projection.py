from pathlib import Path

from server.projection import project_ttml, project_ttml_for_forced
from server.documents import validate_ttml


def test_projection_excludes_ruby_and_non_ttml_paragraphs(tmp_path):
    source = tmp_path / "sample.ttml"
    source.write_text('''<tt xmlns="http://www.w3.org/ns/ttml" xmlns:tts="http://www.w3.org/ns/ttml#styling" xmlns:ext="urn:ext" xmlns:tt="urn:other"><head><metadata><p xml:id="meta">bad</p></metadata></head><body><div><p xml:id="line"><span>前</span><span tts:ruby="container"><span tts:ruby="base">今日</span><span tts:ruby="text">きょう</span></span><br/>後</p><p>无 id</p><ext:p xml:id="x">bad</ext:p><ext:wrapper><p xml:id="bad">bad</p></ext:wrapper></div><tt:p xml:id="bad2">bad</tt:p></body></tt>''', encoding="utf-8")
    assert project_ttml(source) == [{"id": "line", "text": "前今日\n後"}, {"id": "line-1-0-1", "text": "无 id"}]


def test_reference_tool_roles_and_absolute_numeric_times_are_projected_as_main_lyrics():
    evidence = Path(__file__).resolve().parents[2] / "docs/evidence/editor-e0"
    for filename, line_id in [("reference-rich.ttml", "line-1-0-0"), ("studio-roundtrip.ttml", "L1")]:
        source = evidence / filename
        validate_ttml(source.read_text(encoding="utf-8"))
        assert project_ttml(source) == [{"id": line_id, "text": "今日も歌う"}]
        forced = project_ttml_for_forced(source)
        assert len(forced) == 1
        assert forced[0]["text"] == "今日も歌う"
        assert forced[0]["begin"] == 0.0
        assert forced[0]["end"] == 2.0
        assert forced[0]["reading_spans"] == [{
            "ruby_id": f"{line_id}:ruby-0", "base_start": 0, "base_end": 2,
            "base": "今日", "reading": "きょう",
        }]
