"""OS-held data-directory lock; metadata is never evidence of lock ownership."""
import os
from pathlib import Path


class AlreadyRunning(RuntimeError):
    pass


class InstanceLock:
    def __init__(self, root, *, blocking=False):
        self.path = Path(root) / 'runtime' / 'instance.lock'
        self.handle = None
        self.blocking = blocking

    def __enter__(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        handle = self.path.open('a+b')
        try:
            if os.name == 'nt':
                import msvcrt
                if self.path.stat().st_size == 0:
                    handle.write(b'\0'); handle.flush()
                handle.seek(0)
                msvcrt.locking(handle.fileno(), msvcrt.LK_LOCK if self.blocking else msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(handle, fcntl.LOCK_EX | (0 if self.blocking else fcntl.LOCK_NB))
        except OSError as exc:
            handle.close()
            raise AlreadyRunning('此数据目录已在运行') from exc
        self.handle = handle
        return self

    def __exit__(self, *args):
        if self.handle:
            if os.name == 'nt':
                import msvcrt
                self.handle.seek(0)
                msvcrt.locking(self.handle.fileno(), msvcrt.LK_UNLCK, 1)
            self.handle.close()
            self.handle = None
