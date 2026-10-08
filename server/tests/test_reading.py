from fastapi.testclient import TestClient

from server.app import create_app
from server.auth import Settings
from server.db import Database
from server.reading import SudachiReadingProposer


def test_sudachi_uses_whole_word_and_code_point_offsets():
    proposals = SudachiReadingProposer().propose(
        [{"id": "line", "text": "𝄞今日かな"}]
    )
    assert [(item.base, item.base_start, item.base_end) for item in proposals] == [
        ("今日", 1, 3)
    ]


def test_current_snapshot_analysis_has_no_project_dependency():
    from server.reading import ReadingSnapshot, analyze_snapshot
    body = ReadingSnapshot(lines=[{'id': 'main', 'text': '𝄞今日 食べる'}, {'id': 'bg', 'text': '魂'}])
    result = analyze_snapshot(body, SudachiReadingProposer())
    assert [(r.base, r.reading) for r in result.ranges if r.reading] == [('今日', 'きょう'), ('食', 'た'), ('魂', 'たましい')]
    assert result.ranges[0].base == '𝄞'
    for line in body.lines:
        assert ''.join(r.base for r in result.ranges if r.line_id == line.id) == line.text


def test_snapshot_rejects_duplicate_ids_and_surfaces_failure():
    import pytest
    from server.reading import ReadingSnapshot, analyze_snapshot, ReadingUnavailable
    with pytest.raises(ValueError, match='行标识重复'):
        analyze_snapshot(ReadingSnapshot(lines=[{'id': 'a', 'text': '今日'}] * 2), SudachiReadingProposer())
    class Unavailable:
        def propose(self, lines):
            raise ReadingUnavailable('offline')
    with pytest.raises(ReadingUnavailable):
        analyze_snapshot(ReadingSnapshot(lines=[{'id': 'a', 'text': '今日'}]), Unavailable())


def test_snapshot_http_real_sudachi_and_no_revision_write(tmp_path):
    app = create_app(tmp_path, Settings(None, True, 'http://studio'))
    with TestClient(app) as client:
        result = client.post('/api/v1/reading/analyze', headers={'origin': 'http://studio'}, json={'lines': [{'id': 'local-unsaved', 'text': '今日、魂、食べる'}]})
        assert result.status_code == 200
        assert [r['reading'] for r in result.json()['ranges'] if r['reading']] == ['きょう', 'たましい', 'た']
        with Database(tmp_path / 'studio.sqlite3').connect() as conn:
            assert conn.execute('SELECT COUNT(*) FROM revisions').fetchone()[0] == 0
        assert client.post('/api/v1/reading/analyze', headers={'origin': 'http://evil'}, json={'lines': [{'id': 'a', 'text': '今日'}]}).status_code == 403


def test_shared_sudachi_accepts_concurrent_snapshot_requests():
    from concurrent.futures import ThreadPoolExecutor
    from server.reading import ReadingSnapshot, analyze_snapshot
    proposer = SudachiReadingProposer()
    body = ReadingSnapshot(lines=[{'id': 'a', 'text': '今日、食べる、魂'}] )
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(lambda _: analyze_snapshot(body, proposer), range(32)))
    assert all(result == results[0] for result in results)


def test_exact_furigana_and_consistent_a_on_current_text():
    from server.reading import ReadingSnapshot, analyze_snapshot
    result = analyze_snapshot(ReadingSnapshot(lines=[{'id': 'l', 'text': '夜空見上げて 今日 海原 微笑む'}]), SudachiReadingProposer())
    assert [(r.base, r.reading) for r in result.ranges if r.reading] == [
        ('夜', 'よ'), ('空', 'ぞら'), ('見', 'み'), ('上', 'あ'),
        ('今日', 'きょう'), ('海原', 'うなばら'), ('微笑', 'ほほえ')]


def test_furigana_requires_exact_unique_recomposition():
    from server.furigana import build_index
    entries = [
        {'text': '今日', 'reading': 'こんにち', 'furigana': [{'ruby': '今', 'rt': 'こん'}, {'ruby': '日', 'rt': 'にち'}]},
        {'text': '夜空', 'reading': 'よぞら', 'furigana': [{'ruby': '夜', 'rt': 'よ'}, {'ruby': '空', 'rt': 'ぞら'}]},
    ]
    index = build_index(entries + entries)
    assert ('今日', 'きょう') not in index
    assert index['夜空', 'よぞら'] == (('夜', 'よ'), ('空', 'ぞら'))
    assert ('夜空', 'よぞら') not in build_index(entries + [{'text': '夜空', 'reading': 'よぞら', 'furigana': [{'ruby': '夜空', 'rt': 'よぞら'}]}])
    assert not build_index([{'text': '夜空', 'reading': 'よぞら', 'furigana': [{'ruby': '夜', 'rt': 'よぞら'}]}])


def test_inconsistent_a_cannot_replace_c_reading():
    from server.furigana import token_segments
    from server.reading import _hiragana
    class Token:
        def __init__(self, base, reading, start, children=()):
            self.base, self.reading, self.start, self.children = base, reading, start, children
        def surface(self): return self.base
        def reading_form(self): return self.reading
        def begin(self): return self.start
        def end(self): return self.start + len(self.base)
        def split(self, mode): return self.children
    children = [Token('今', 'コン', 2), Token('日', 'ニチ', 3)]
    assert token_segments(Token('今日', 'キョウ', 2, children), {}, None, _hiragana) == [(2, 4, '今日', 'きょう')]
    children = [Token('見', 'ミ', 2), Token('上げ', 'アゲ', 3)]
    assert token_segments(Token('見上げ', 'ミアゲ', 2, children), {}, None, _hiragana) == [(2, 3, '見', 'み'), (3, 5, '上げ', 'あげ')]
    children[1].start = 4
    assert token_segments(Token('見上げ', 'ミアゲ', 2, children), {}, None, _hiragana) == [(2, 5, '見上げ', 'みあげ')]


def test_missing_furigana_resource_is_explicit_failure(monkeypatch, tmp_path):
    import server.furigana as resource
    from server.reading import ReadingUnavailable
    import pytest
    resource.load_index.cache_clear()
    monkeypatch.setattr(resource, 'RESOURCE', tmp_path / 'missing.gz')
    proposer = SudachiReadingProposer()
    assert not proposer.available
    with pytest.raises(ReadingUnavailable, match='读音资源不可用'):
        proposer.propose([{'id': 'l', 'text': '夜空'}])
    resource.load_index.cache_clear()
