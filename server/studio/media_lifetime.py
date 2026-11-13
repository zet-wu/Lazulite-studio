"""Project page leases and request ownership for active media resources."""
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path
import threading
import time
from .media import MediaService


@dataclass
class Entry:
    media: MediaService
    requests: int = 0
    pages: dict[str, float] = field(default_factory=dict)


class MediaLifetime:
    def __init__(self, root: Path, *, ttl=180, clock=time.monotonic):
        self.root, self.ttl, self.clock = root, ttl, clock
        self.entries: dict[str, Entry] = {}
        self.closed: dict[tuple[str, str], float] = {}
        self.lock = threading.RLock()
        self.stop = threading.Event()
        self.thread = None

    def _entry(self, pid):
        if pid not in self.entries: self.entries[pid] = Entry(MediaService(self.root / pid))
        return self.entries[pid]

    def heartbeat(self, pid, page):
        with self.lock:
            # A late heartbeat must not resurrect a page which already left.
            if (pid, page) not in self.closed:
                self._entry(pid).pages[page] = self.clock() + self.ttl

    def leave(self, pid, page):
        with self.lock:
            self.closed[pid, page] = self.clock() + self.ttl
            if pid in self.entries:
                self.entries[pid].pages.pop(page, None)
                self._collect(pid)

    def _collect(self, pid):
        entry = self.entries[pid]
        now = self.clock()
        entry.pages = {key: expiry for key, expiry in entry.pages.items() if expiry > now}
        if not entry.pages and not entry.requests:
            entry.media.clear()
            del self.entries[pid]

    def sweep(self):
        with self.lock:
            for pid in list(self.entries): self._collect(pid)
            now = self.clock()
            self.closed = {key: expiry for key, expiry in self.closed.items() if expiry > now}

    def retain(self, pid):
        with self.lock:
            entry = self._entry(pid)
            entry.requests += 1
        released = False
        def release():
            nonlocal released
            with self.lock:
                if released: return
                released = True
                entry.requests -= 1
                self._collect(pid)
        return entry.media, release

    @contextmanager
    def use(self, pid):
        media, release = self.retain(pid)
        try: yield media
        finally: release()

    def invalidate(self, pid):
        with self.lock:
            if pid in self.entries: self.entries[pid].media.clear()

    def start(self):
        def reap():
            while not self.stop.wait(30): self.sweep()
        self.thread = threading.Thread(target=reap, name='media-leases', daemon=True)
        self.thread.start()

    def close(self):
        self.stop.set()
        if self.thread: self.thread.join()
        with self.lock:
            for entry in self.entries.values(): entry.media.clear()
            self.entries.clear()
            self.closed.clear()
