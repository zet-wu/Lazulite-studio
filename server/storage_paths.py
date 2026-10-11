"""The v5 database stores only data-root-relative POSIX resource names."""
from pathlib import Path, PurePosixPath, PureWindowsPath


class StoragePaths:
    def __init__(self, root):
        self.root = Path(root).resolve()

    def resolve(self, value: str) -> Path:
        if not isinstance(value, str) or not value or '\\' in value or '\x00' in value:
            raise ValueError('资源路径无效')
        path = PurePosixPath(value)
        if path.is_absolute() or PureWindowsPath(value).drive or any(p in {'..', '.'} for p in value.split('/')):
            raise ValueError('资源路径必须为数据目录内的相对路径')
        resolved = (self.root / path).resolve()
        if not resolved.is_relative_to(self.root) or resolved == self.root:
            raise ValueError('资源路径越出数据目录')
        return resolved

    def store(self, path) -> str:
        value = Path(path).resolve().relative_to(self.root).as_posix()
        self.resolve(value)
        return value


def validate_database_paths(db):
    """Run before recovery/collection; never clean a partially validated library."""
    import json
    for directory in ('projects', '.deleting'):
        for path in (db.paths.root / directory).rglob('*'):
            if path.is_symlink(): raise ValueError('数据目录含符号链接，已停止启动清理')
    def exists(value, directory=False):
        path = db.paths.resolve(value)
        if path.is_dir() if directory else path.is_file(): return True
        # An interrupted deletion is restored only after all references pass.
        parts = PurePosixPath(value).parts
        quarantine = db.paths.resolve('/'.join(('.deleting', *parts[1:])))
        return quarantine.is_dir() if directory else quarantine.is_file()
    with db.connect() as conn:
        for row in conn.execute('SELECT id,project_id,project_path FROM revisions'):
            expected = f'projects/{row[1]}/revisions/{row[0]}.json'
            if row[2] != expected or not exists(row[2]):
                raise ValueError('修订引用无效或文件缺失；已停止启动清理，请恢复完整数据副本')
        for row in conn.execute('SELECT id,project_id,directory FROM vocal_results'):
            if row[2] != f'projects/{row[1]}/vocals/{row[0]}' or not exists(row[2], directory=True):
                raise ValueError('人声引用无效或目录缺失；已停止启动清理')
        for row in conn.execute('SELECT project_id,result_json FROM jobs WHERE result_json IS NOT NULL'):
            result = json.loads(row[1])
            if result.get('output_path'):
                path = db.paths.resolve(result['output_path'])
                if path.parent != db.paths.resolve(f'projects/{row[0]}/exports'):
                    raise ValueError('发布产物引用无效；已停止启动清理')
