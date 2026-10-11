"""Flush file contents before replacement; directory fsync is a POSIX facility."""
import os
import tempfile
from pathlib import Path


def fsync_directory(path: Path):
    if os.name == 'nt':
        # CRT cannot open directories. File fsync + same-volume os.replace remain
        # mandatory; Windows sharing/permission/disk errors are never suppressed.
        return
    fd = os.open(path, os.O_RDONLY | getattr(os, 'O_DIRECTORY', 0))
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def write_atomic(path: Path, content: bytes):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix=f'.{path.name}-', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(name, path)
        fsync_directory(path.parent)
    finally:
        Path(name).unlink(missing_ok=True)
