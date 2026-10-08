from server.alignment_projection import project_alignment
from server.project_document import initial_project


def fixture():
    return initial_project('''<tt xmlns="http://www.w3.org/ns/ttml" xmlns:studio="urn:lazulite:studio:draft" xmlns:tts="http://www.w3.org/ns/ttml#styling" xmlns:ttm="http://www.w3.org/ns/ttml#metadata"><body><p xml:id="main" begin="0"><span studio:id="mixed">𠮷がlove12</span><span studio:id="word" tts:ruby="container"><span tts:ruby="base">love</span><span tts:ruby="textContainer"><span studio:id="r1" tts:ruby="text">ら</span><span studio:id="r2" tts:ruby="text">bad</span><span studio:id="r3" tts:ruby="text">ぶ</span></span></span><span studio:id="space"> ！</span><span ttm:role="x-bg" studio:id="bg"><span studio:id="bgword">(アー)</span></span></p></body></tt>''', None)


def test_projection_preserves_unknown_ids_unicode_ruby_and_display_order():
    snapshot = fixture(); snapshot['lineOrder'] = ['bg', 'main']
    result = project_alignment(snapshot, True)
    bg, main = result['request']['lines']
    assert [bg['line_id'], main['line_id']] == ['bg', 'main']
    assert bg['text'] == 'アー'
    assert main['text'] == '𠮷がlove12love ！'
    assert [u['reading_language'] for u in main['units']] == ['unknown', 'ja', 'en', 'unknown', 'ja', 'unknown', 'ja']
    assert main['units'][1]['source_range'] == (1, 3)
    assert main['units'][1]['reading'] == 'が'
    assert main['units'][2]['reading'] == 'love'
    assert main['units'][-3]['source_range'] == main['units'][-1]['source_range'] == (9, 13)
    assert main['start_hint'] == {'time': 0.0, 'source': 'unknown', 'route': None}
    assert result['summary']['unknown_count'] == 2
    assert all(m['object_id'] != 'space' for m in result['mapping'])
    assert project_alignment(snapshot)['request']['lines'][1]['start_hint'] is None


def test_skipping_filters_after_order_without_propagating_or_hints():
    snapshot=fixture(); snapshot['lineOrder']=['bg','main']; snapshot['editing']['skippedAlignmentLineIds']=['main']
    result=project_alignment(snapshot, True)
    assert [l['line_id'] for l in result['request']['lines']] == ['bg']
    assert result['summary']['hint_count'] == 0
    snapshot['editing']['skippedAlignmentLineIds']=['bg','main']
    assert project_alignment(snapshot)['summary']['emitting_count'] == 0


def test_multiple_background_order_and_english_ruby_are_independent():
    snapshot = fixture()
    snapshot['lyrics']['draftTtml'] = snapshot['lyrics']['draftTtml'].replace('</p>', '<span ttm:role="x-bg" studio:id="bg2" begin="1"><span studio:id="bgword2">(R)</span></span></p>')
    snapshot['lineOrder'] = ['bg2', 'main', 'bg']
    result = project_alignment(snapshot, True)
    assert [line['line_id'] for line in result['request']['lines']] == ['bg2', 'main', 'bg']
    assert result['request']['lines'][0]['units'][0]['reading_language'] == 'en'
    assert result['request']['lines'][0]['units'][0]['reading'] == 'R'
    rubies = [unit for line in result['request']['lines'] for unit in line['units'] if unit['reading_source'] == 'ruby']
    assert [unit['reading'] for unit in rubies] == ['ら', 'bad', 'ぶ']
    snapshot['editing']['skippedAlignmentLineIds'] = ['bg2']
    result = project_alignment(snapshot, True)
    assert [line['line_id'] for line in result['request']['lines']] == ['main', 'bg']
    assert result['summary']['hint_count'] == 1
