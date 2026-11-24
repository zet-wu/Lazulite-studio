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
    from server.reading import JapaneseReadingSnapshot, analyze_snapshot
    body = JapaneseReadingSnapshot(lines=[{'id': 'main', 'text': '𝄞今日 食べる'}, {'id': 'bg', 'text': '魂'}])
    result = analyze_snapshot(body, SudachiReadingProposer())
    assert [(r.base, r.reading) for r in result.ranges if r.reading] == [('今日', 'きょう'), ('食', 'た'), ('魂', 'たましい')]
    assert result.ranges[0].base == '𝄞'
    for line in body.lines:
        assert ''.join(r.base for r in result.ranges if r.line_id == line.id) == line.text


def test_snapshot_rejects_duplicate_ids_and_surfaces_failure():
    import pytest
    from server.reading import JapaneseReadingSnapshot, analyze_snapshot, ReadingUnavailable
    with pytest.raises(ValueError, match='行标识重复'):
        analyze_snapshot(JapaneseReadingSnapshot(lines=[{'id': 'a', 'text': '今日'}] * 2), SudachiReadingProposer())
    class Unavailable:
        def propose(self, lines, auto_merge=False):
            raise ReadingUnavailable('offline')
    with pytest.raises(ReadingUnavailable):
        analyze_snapshot(JapaneseReadingSnapshot(lines=[{'id': 'a', 'text': '今日'}]), Unavailable())


def test_snapshot_http_real_sudachi_and_no_revision_write(tmp_path):
    app = create_app(tmp_path, Settings(None, True))
    with TestClient(app) as client:
        result = client.post('/api/v1/reading/analyze', headers={'origin': 'http://studio'}, json={'lines': [{'id': 'local-unsaved', 'text': '今日、魂、食べる'}]})
        assert result.status_code == 200
        assert [r['reading'] for r in result.json()['ranges'] if r['reading']] == ['きょう', 'たましい', 'た']
        with Database(tmp_path / 'studio.sqlite3').connect() as conn:
            assert conn.execute('SELECT COUNT(*) FROM revisions').fetchone()[0] == 0


def test_shared_sudachi_accepts_concurrent_snapshot_requests():
    from concurrent.futures import ThreadPoolExecutor
    from server.reading import JapaneseReadingSnapshot, analyze_snapshot
    proposer = SudachiReadingProposer()
    body = JapaneseReadingSnapshot(lines=[{'id': 'a', 'text': '今日、食べる、魂'}] )
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(lambda _: analyze_snapshot(body, proposer), range(32)))
    assert all(result == results[0] for result in results)


def test_exact_furigana_and_consistent_a_on_current_text():
    from server.reading import JapaneseReadingSnapshot, analyze_snapshot
    result = analyze_snapshot(JapaneseReadingSnapshot(lines=[{'id': 'l', 'text': '夜空見上げて 今日 海原 微笑む'}]), SudachiReadingProposer())
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


def test_dictionary_load_accepts_replacement_content_and_rejects_bad_structure(tmp_path, monkeypatch):
    import gzip, json, pytest
    import server.furigana as resource
    path = tmp_path / 'dictionary.gz'
    monkeypatch.setattr(resource, 'RESOURCE', path)
    try:
        for surface, reading in [('今日','きょう'), ('明日','あした')]:
            path.write_bytes(gzip.compress(json.dumps([{'text':surface, 'reading':reading, 'furigana':[{'ruby':surface,'rt':reading}]}]).encode()))
            resource.load_index.cache_clear()
            assert resource.load_index() == {(surface, reading): ((surface, reading),)}
        for entries in [{}, [{'text':'字','reading':'じ','furigana':[{'ruby':'字','rt':1}]}]]:
            path.write_bytes(gzip.compress(json.dumps(entries).encode()))
            resource.load_index.cache_clear()
            with pytest.raises(ValueError, match='词典'): resource.load_index()
    finally: resource.load_index.cache_clear()


def test_proposer_range_boundary_rejects_mismatches_and_overlap():
    import pytest
    from server.reading import ReadingProposal, JapaneseReadingSnapshot, analyze_snapshot
    body = JapaneseReadingSnapshot(lines=[{'id':'l','text':'今日'}])
    class Proposer:
        def __init__(self, items): self.items = items
        def propose(self, lines, auto_merge=False): return self.items
    valid = ReadingProposal('l', 0, 2, '今日', 'きょう')
    for items in [[ReadingProposal('l',0,2,'昨日','きのう')], [valid,valid]]:
        with pytest.raises(ValueError): analyze_snapshot(body, Proposer(items))


def test_arabic_numbers_cardinals_and_counter_merge():
    from server.reading import JapaneseReadingSnapshot, analyze_snapshot
    proposer = SudachiReadingProposer()
    text = '300 ６００ 800 3000 8000 1024 3本 6匹 1人 2人 20歳'
    def ranges(merge):
        result = analyze_snapshot(JapaneseReadingSnapshot(lines=[{'id':'l','text':text}], auto_merge=merge), proposer)
        assert ''.join(r.base for r in result.ranges) == text
        return {r.base:r.reading for r in result.ranges if r.reading}
    separate = ranges(False)
    assert separate['300'] == 'さんびゃく'
    assert separate['６００'] == 'ろっぴゃく'
    assert separate['800'] == 'はっぴゃく'
    assert separate['3000'] == 'さんぜん'
    assert separate['8000'] == 'はっせん'
    assert separate['1024'] == 'せんにじゅうよん'
    assert separate['1'] == 'いち' and '1人' not in separate
    merged = ranges(True)
    assert merged['3本'] == 'さんぼん'
    assert merged['6匹'] == 'ろっぴき'
    assert merged['1人'] == 'ひとり' and merged['2人'] == 'ふたり'
    assert merged['20歳'] == 'はたち'

def test_numeric_tokens_filter_remainder_and_respect_counter_boundaries():
    from server.reading import JapaneseReadingSnapshot, analyze_snapshot
    proposer = SudachiReadingProposer()
    for merge in (False, True):
        text = '1つ 100% 3-4 1ヶ月 1日本 3人間 14時 24時 1000本'
        result = analyze_snapshot(JapaneseReadingSnapshot(lines=[{'id':'l','text':text}], auto_merge=merge), proposer)
        assert ''.join(row.base for row in result.ranges) == text
        readings = {row.base:row.reading for row in result.ranges if row.reading}
        assert not any(base in readings for base in ('つ','%','-','1日','3人'))
        if merge:
            assert readings['1ヶ月'] == 'いっかげつ'
            assert readings['14時'] == 'じゅうよじ'
            assert readings['24時'] == 'にじゅうよじ'
            assert readings['1000本'] == 'せんぼん'
