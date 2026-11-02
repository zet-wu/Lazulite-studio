"""Normalize automatic intervals without changing persisted media metadata."""
from .document_errors import DocumentInvalid


def source_duration(db, project_id, asset_id):
    with db.connect() as conn:
        row = conn.execute('SELECT a.duration_ms FROM projects p JOIN assets a ON a.id=p.source_asset_id WHERE p.id=? AND p.source_asset_id=?', (project_id, asset_id)).fetchone()
    if row is None:
        raise DocumentInvalid('analysis_source_mismatch', '分析不属于当前源音频', asset_id=asset_id)
    if row[0] is None:
        raise DocumentInvalid('source_duration_unknown', '源音频时长未知，无法接入自动结果', asset_id=asset_id)
    return row[0]


def intersect_segments(segments, duration_ms):
    result, clipped, dropped = [], 0, 0
    for segment in segments:
        begin, end = max(0, segment['beginMs']), min(duration_ms, segment['endMs'])
        if begin >= end:
            dropped += 1
            continue
        if begin != segment['beginMs'] or end != segment['endMs']:
            clipped += 1
        result.append({**segment, 'beginMs': begin, 'endMs': end})
    return result, {'clipped': clipped, 'dropped': dropped}
