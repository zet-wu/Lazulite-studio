from server.audio_boundaries import intersect_segments


def test_automatic_intersection_is_not_a_fixed_rounding_tolerance():
    rows = [{'id': 'a', 'beginMs': 900, 'endMs': 1100}, {'id': 'b', 'beginMs': 1021, 'endMs': 1600}]
    bounded, summary = intersect_segments(rows, 1021)
    assert bounded == [{'id': 'a', 'beginMs': 900, 'endMs': 1021}]
    assert summary == {'clipped': 1, 'dropped': 1}
    assert rows[0]['endMs'] == 1100
