"""Process-local compiled indexes; marshal contains only ordinary data, never code."""
from collections import OrderedDict
import logging
import marshal
from pathlib import Path
import shutil
import tempfile
import time

from .dictionary_engine import DictionaryIndex
from .instance_lock import AlreadyRunning, InstanceLock

log = logging.getLogger(__name__)


class IndexCache:
    ttl = 30 * 60

    def __init__(self, root):
        root = Path(root) / ".indexes"
        root.mkdir(exist_ok=True)
        # Serialize creation/cleanup so a new directory cannot be mistaken for
        # a crashed owner before its lock has been acquired.
        with InstanceLock(root, blocking=True):
            for old in root.glob("run-*"):
                try:
                    with InstanceLock(old):
                        self._clear(old)
                    shutil.rmtree(old)
                except AlreadyRunning:
                    continue
                except OSError:
                    log.warning("无法清理遗留词典索引 %s", old, exc_info=True)
            self.directory = Path(tempfile.mkdtemp(prefix="run-", dir=root))
            self.owner = InstanceLock(self.directory)
            self.owner.__enter__()
        self.memory = OrderedDict()
        self.recent = {}

    @staticmethod
    def _clear(directory):
        for path in directory.glob("*.index"):
            path.unlink()

    def path(self, instance):
        return self.directory / (instance + ".index")

    def expire(self):
        now = time.monotonic()
        for instance, used in list(self.recent.items()):
            if now - used >= self.ttl:
                self.discard_disk(instance)

    def discard_disk(self, instance):
        self.recent.pop(instance, None)
        try:
            self.path(instance).unlink(missing_ok=True)
        except OSError:
            log.warning("无法删除临时词典索引 %s", instance, exc_info=True)

    def invalidate(self, instance):
        self.memory.pop(instance, None)
        self.discard_disk(instance)

    def get(self, instance):
        index = self.memory.get(instance)
        if index is not None:
            self.memory.move_to_end(instance)
            if instance in self.recent:
                self.recent[instance] = time.monotonic()
        return index

    def publish(self, instance, index, disk):
        self.memory[instance] = index
        self.memory.move_to_end(instance)
        while len(self.memory) > 2:
            self.memory.popitem(last=False)
        if disk:
            self.recent[instance] = time.monotonic()

    def restore(self, instance):
        with self.path(instance).open("rb") as stream:
            manifest, sources, count, unknown, entries, max_len, alternatives = marshal.load(stream)
        index = DictionaryIndex.__new__(DictionaryIndex)
        index.manifest, index.sources = manifest, sources
        index.count, index.unknown, index.entries, index.max_len = count, unknown, entries, max_len
        index.alternatives = alternatives
        return index

    def write(self, instance, index):
        path = self.path(instance)
        temporary = path.with_suffix(".tmp")
        try:
            with temporary.open("wb") as stream:
                marshal.dump((index.manifest, index.sources, index.count, index.unknown, index.entries, index.max_len, index.alternatives), stream)
            temporary.replace(path)
            return True
        except (OSError, ValueError):
            log.warning("临时词典索引写入失败，继续使用内存索引", exc_info=True)
            try:
                temporary.unlink(missing_ok=True)
            except OSError:
                log.warning("临时词典索引文件清理失败", exc_info=True)
            return False

    def close(self):
        self.memory.clear()
        self.recent.clear()
        with InstanceLock(self.directory.parent, blocking=True):
            self.owner.__exit__()
            shutil.rmtree(self.directory)
