"""Explicit, copy-only v4 -> v5 conversion. Never open legacy external paths."""
import argparse
import json
import shutil
import sqlite3
from pathlib import Path, PurePosixPath, PureWindowsPath
from .storage_paths import StoragePaths, validate_database_paths
from .instance_lock import InstanceLock


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
            value = json.loads(raw)
            if value.get('output_path'):
                old = value['output_path'].replace('\\', '/')
                expected = f'projects/{pid}/exports/{PurePosixPath(old).name}'
                if pid not in projects or not old.endswith('/' + expected): raise ValueError('发布归属无法核实')
                path = paths.resolve(expected)
                if not value.get('superseded') and value.get('report', {}).get('passed') and not path.is_file():
                    raise ValueError('成功发布产物缺失')
                value['output_path'] = expected
                changes.append(('jobs', 'result_json', jid, json.dumps(value, ensure_ascii=False)))
        # Reject legacy path-bearing requests; current v4 jobs contain IDs and
        # computation parameters only. Do not silently preserve machine paths.
        for jid, raw in conn.execute('SELECT id,request_json FROM jobs'):
            def audit(value):
                if isinstance(value, dict):
                    for key, item in value.items():
                        if ('path' in key or key in {'directory', 'root'}) and isinstance(item, str):
                            raise ValueError(f'任务 {jid} 含旧路径字段 {key}，需人工处理')
                        audit(item)
                elif isinstance(value, list):
                    for item in value: audit(item)
            audit(json.loads(raw))
    for path in source.rglob('*'):
        if path.is_symlink(): raise ValueError('源副本含符号链接，拒绝转换')
    return changes


def migrate(source, destination=None):
    source = Path(source).resolve()
    with InstanceLock(source):
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
        validate_database_paths(Database(destination / 'studio.sqlite3'))
        report['destination'] = str(destination)
        return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='停服并备份后执行；省略 --destination 只读检查，不转换原目录。失败副本保留供排查。')
    parser.add_argument('source', type=Path)
    parser.add_argument('--destination', type=Path)
    args = parser.parse_args()
    print(json.dumps(migrate(args.source, args.destination), ensure_ascii=False, indent=2))
