"""Explicit, copy-only v4 -> v5 conversion. Never open legacy external paths."""
import argparse
import json
import shutil
import sqlite3
from pathlib import Path, PurePosixPath
from .storage_paths import StoragePaths, validate_database_paths


def remove_installation_paths(value):
    if isinstance(value, dict):
        return {key: remove_installation_paths(item) for key, item in value.items() if key not in {'model_path', 'model_repo'}}
    if isinstance(value, list): return [remove_installation_paths(item) for item in value]
    return value


def inspect(source):
    source = Path(source).resolve()
    paths = StoragePaths(source)
    dbfile = source / 'studio.sqlite3'
    changes = []
    with sqlite3.connect(dbfile.as_uri() + '?mode=ro', uri=True) as conn:
        if conn.execute('PRAGMA user_version').fetchone()[0] != 4:
            raise ValueError('转换只接受 v4 副本')
        projects = {row[0] for row in conn.execute('SELECT id FROM projects')}
        for table, column, folder, suffix in [('revisions', 'project_path', 'revisions', '.json'), ('vocal_results', 'directory', 'vocals', '')]:
            for rid, pid, old in conn.execute(f'SELECT id,project_id,{column} FROM {table}'):
                expected = f'projects/{pid}/{folder}/{rid}{suffix}'
                if pid not in projects or not old.replace('\\', '/').endswith('/' + expected) or not paths.resolve(expected).exists():
                    raise ValueError(f'{table} 存在无法核实的引用：{rid}')
                changes.append((table, column, rid, expected))
        for jid, pid, raw in conn.execute('SELECT id,project_id,result_json FROM jobs WHERE result_json IS NOT NULL'):
            value = remove_installation_paths(json.loads(raw))
            if value.get('output_path'):
                old = value['output_path'].replace('\\', '/')
                expected = f'projects/{pid}/exports/{PurePosixPath(old).name}'
                if pid not in projects or not old.endswith('/' + expected): raise ValueError('发布归属无法核实')
                path = paths.resolve(expected)
                if not value.get('superseded') and value.get('report', {}).get('passed') and not path.is_file():
                    raise ValueError('成功发布产物缺失')
                value['output_path'] = expected
            if value != json.loads(raw):
                changes.append(('jobs', 'result_json', jid, json.dumps(value, ensure_ascii=False)))
        for table, column in [('jobs', 'engine_json'), ('vocal_results', 'metadata_json')]:
            for rid, raw in conn.execute(f'SELECT id,{column} FROM {table} WHERE {column} IS NOT NULL'):
                value = remove_installation_paths(json.loads(raw))
                if value != json.loads(raw): changes.append((table, column, rid, json.dumps(value, ensure_ascii=False)))
        # Reject legacy path-bearing requests; current v4 jobs contain IDs and
        # computation parameters only. Do not silently preserve machine paths.
        for jid, raw in conn.execute('SELECT id,request_json FROM jobs'):
            def audit(value):
                if isinstance(value, dict):
                    for key, item in value.items():
                        if ('path' in key or key in {'directory', 'root', 'model_repo'}) and isinstance(item, str):
                            raise ValueError(f'任务 {jid} 含旧路径字段 {key}，需人工处理')
                        audit(item)
                elif isinstance(value, list):
                    for item in value: audit(item)
            audit(json.loads(raw))
    for path in source.rglob('*'):
        if path.is_symlink(): raise ValueError('源副本含符号链接，拒绝转换')
    return changes


def validate_contents(db):
    """Migration checks every immutable snapshot and referenced vocal product."""
    from .project_document import read_project, validate_project
    from .vocals import VocalRunner
    import numpy as np
    runner = VocalRunner(db, db.paths.root / 'projects', cleanup=False)
    with db.connect() as conn:
        for row in conn.execute('SELECT project_id,project_path FROM revisions'):
            validate_project(read_project(db.paths.resolve(row[1])), conn, row[0])
        for row in conn.execute('SELECT id,source_asset_id FROM projects WHERE source_asset_id IS NOT NULL'):
            if not db.paths.resolve(f'projects/{row[0]}/source/original').is_file():
                raise ValueError('源音频缺失，转换副本不可启用')
        for row in conn.execute('SELECT * FROM vocal_results'):
            metadata = json.loads(row['metadata_json'])
            if metadata['source_asset_id'] != row['source_asset_id'] or not runner.audio_available(row['project_id'], metadata):
                raise ValueError('人声格式或引用校验失败，转换副本不可启用')
            if row['status'] == 'ready':
                values = np.load(db.paths.resolve(row['directory']) / 'energy.npy', allow_pickle=False, mmap_mode='r')
                if values.ndim != 1 or not np.isfinite(values).all(): raise ValueError('人声能量数据无效')


def migrate(source, destination=None):
    source = Path(source).resolve()
    changes = inspect(source)
    report = {'source': str(source), 'changes': len(changes), 'dry_run': destination is None}
    if destination is None: return report
    destination = Path(destination).resolve()
    if destination.exists() or destination.is_relative_to(source): raise ValueError('目标必须是源目录之外的新目录')
    shutil.copytree(source, destination)
    # SQLite backup includes committed WAL pages without copying stale handles.
    with sqlite3.connect((source / 'studio.sqlite3').as_uri() + '?mode=ro', uri=True) as old:
        with sqlite3.connect(destination / 'studio.sqlite3') as new:
            old.backup(new)
            for table, column, rid, value in changes:
                new.execute(f'UPDATE {table} SET {column}=? WHERE id=?', (value, rid))
            new.execute('PRAGMA user_version=5')
    from .db import Database
    database = Database(destination / 'studio.sqlite3')
    try:
        validate_database_paths(database)
        validate_contents(database)
    except Exception:
        # A failed copy must not look like an admitted v5 database on next launch.
        with sqlite3.connect(destination / 'studio.sqlite3') as rejected:
            rejected.execute('PRAGMA user_version=4')
        raise
    report['destination'] = str(destination)
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='停服并备份后执行；省略 --destination 只读检查，不转换原目录。失败副本保留供排查。')
    parser.add_argument('source', type=Path)
    parser.add_argument('--destination', type=Path)
    args = parser.parse_args()
    print(json.dumps(migrate(args.source, args.destination), ensure_ascii=False, indent=2))
