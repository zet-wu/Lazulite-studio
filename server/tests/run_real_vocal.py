"""Opt-in full-song probe: python -m server.tests.run_real_vocal --source FILE --root DIR.

Uses the actual configured Demucs runtime and persists an isolated project suitable
for STUDIO_VOCAL_REAL_ROOT browser fixtures. Never modifies the development database.
"""
import argparse
import json
import os
import time
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--threads', type=int, default=4)
    args = parser.parse_args()
    if not args.source.is_file(): parser.error('source must be an existing audio file')
    if args.root.exists() and any(args.root.iterdir()): parser.error('root must be empty to preserve earlier results')
    os.environ['OMP_NUM_THREADS'] = str(args.threads)
    os.environ['MKL_NUM_THREADS'] = str(args.threads)
    from server.db import Database
    from server.revisions import RevisionStore
    from server.tests.media_fixture import add_media_project
    from server.vocals import VocalRunner
    args.root.mkdir(parents=True, exist_ok=True)
    db = Database(args.root / 'studio.sqlite3')
    add_media_project(args.root, db, RevisionStore(db, args.root / 'revisions'), 'real', args.source,
                      '<tt xmlns="http://www.w3.org/ns/ttml"><body><div/></body></tt>')
    with db.connect() as c:
        asset = c.execute("SELECT source_asset_id FROM projects WHERE id='real'").fetchone()[0]
    start = time.monotonic()
    result = VocalRunner(db, args.root / 'vocals').run('real', args.source, {
        'asset_id': asset, 'model_name': os.getenv('STUDIO_VOCAL_MODEL', 'htdemucs'),
        'device': os.getenv('STUDIO_VOCAL_DEVICE', 'cpu'),
    }, 'actual-demucs', lambda *values: print(values, flush=True), lambda: False)
    print(json.dumps({'result': result, 'elapsed_seconds': time.monotonic() - start}), flush=True)


if __name__ == '__main__': main()
