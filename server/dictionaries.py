"""Library-scoped dictionary instances; publish an activity record, never swap open directories."""
import json
import re
import shutil
import tempfile
import threading
import uuid
import zipfile
from contextlib import contextmanager
from pathlib import Path

from .atomic_file import write_atomic
from .dictionary_engine import DictionaryIndex
from .dictionary_format import MAX_LINE, extract_package, inspect_package, read_json, validate_manifest


class DictionaryConflict(ValueError):
    pass


class Dictionaries:
    def __init__(self, root, defaults=None):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        self.path = self.root / "active.json"
        self.record = read_json(self.path.read_text("utf-8")) if self.path.exists() else {"installed": {}, "defaults": []}
        if not isinstance(self.record, dict) or set(self.record) != {"installed", "defaults"} or not isinstance(self.record["installed"], dict) or not isinstance(self.record["defaults"], list):
            raise ValueError("词典活动记录损坏，请恢复 dictionaries/active.json")
        for ident, directory in self.record["installed"].items():
            if not re.fullmatch(r"[a-z0-9][a-z0-9._-]{0,79}", ident) or not isinstance(directory, str) or not re.fullmatch("[a-f0-9]{32}", directory):
                raise ValueError("词典活动记录路径无效")
        self.instances = {ident: uuid.uuid4().hex for ident in self.record["installed"]}
        self.cache = None
        self.leases = {}
        self.retired = set()
        self.cleanup_errors = {}
        # Orphans can only be created before publication or after a crash.
        for directory in self.root.iterdir():
            if directory.is_symlink():
                raise ValueError("词典目录不能包含符号链接")
            if directory.is_dir() and re.fullmatch("[a-f0-9]{32}", directory.name) and directory.name not in self.record["installed"].values():
                self._retire(directory.name)
        self.default_errors = []
        if defaults:
            for archive in sorted(Path(defaults).glob("*.zip")):
                try:
                    self.install(archive, default=True)
                except (ValueError, KeyError, OSError, zipfile.BadZipFile) as exc:
                    self.default_errors.append(f"{archive.name}：{exc}；请修复随附词典后重启")

    def _write(self, record):
        write_atomic(self.path, json.dumps(record, ensure_ascii=False).encode("utf-8"))
        self.record = record

    def list(self):
        with self.lock:
            for directory in list(self.retired):
                if not self.leases.get(directory, 0):
                    self._retire(directory)
            result = []
            for ident, directory in self.record["installed"].items():
                item = {"id": ident, "instance": self.instances[ident], "error": None}
                try:
                    path = self.root / directory
                    if path.is_symlink():
                        raise ValueError("词典实例目录不能是符号链接")
                    item["manifest"] = validate_manifest(read_json((path / "manifest.json").read_text("utf-8")))
                    if item["manifest"]["id"] != ident:
                        raise ValueError("已安装词典 ID 被修改，请重新导入")
                    item["sources"] = read_json((path / "sources.json").read_text("utf-8"))
                except (ValueError, OSError) as exc:
                    item["error"] = f"词典无法读取：{exc}；请重新导入或移除"
                    item["manifest"] = None
                    item["sources"] = None
                result.append(item)
            return {"dictionaries": result, "errors": self.default_errors + list(self.cleanup_errors.values())}

    def install(self, archive, replace=False, default=False, inspect=False):
        if inspect:
            manifest, sources = inspect_package(archive)
            with self.lock:
                return {"manifest": manifest, "sources": sources, "entryCount": None,
                        "replaceRequired": manifest["id"] in self.record["installed"]}
        if default:
            with zipfile.ZipFile(archive) as z:
                member = z.getinfo("manifest.json")
                if member.file_size > MAX_LINE:
                    raise ValueError("词典清单过大")
                manifest = validate_manifest(read_json(z.read(member).decode("utf-8")))
            with self.lock:
                if manifest["id"] in self.record["defaults"]:
                    return None
        with tempfile.TemporaryDirectory(prefix=".import-", dir=self.root) as tmp:
            extract_package(archive, tmp)
            index = DictionaryIndex(tmp)
            manifest, sources, count = index.manifest, index.sources, index.count
            ident = manifest["id"]
            info = {"manifest": manifest, "sources": sources, "entryCount": count}
            with self.lock:
                exists = ident in self.record["installed"]
                if default and ident in self.record["defaults"]:
                    return None
                if exists and not replace and not default:
                    raise DictionaryConflict("相同 ID 词典已安装，请核对名称、版本、地区和来源后明确替换")
                record = json.loads(json.dumps(self.record))
                if default:
                    record["defaults"].append(ident)
                    if exists:
                        self._write(record)
                        return None
                directory = uuid.uuid4().hex
                old = record["installed"].get(ident)
                shutil.move(tmp, self.root / directory)
                record["installed"][ident] = directory
                try:
                    self._write(record)
                except BaseException:
                    shutil.rmtree(self.root / directory)
                    raise
                instance = uuid.uuid4().hex
                self.instances[ident] = instance
                self.cache = (instance, index)
                if old:
                    self._retire(old)
                return {**info, "instance": instance}

    def _retire(self, directory):
        self.retired.add(directory)
        if self.leases.get(directory, 0):
            return
        try:
            if (self.root / directory).exists():
                shutil.rmtree(self.root / directory)
        except OSError as exc:
            # Publication already succeeded. File locks only postpone disposal;
            # they must not turn a completed replacement into an apparent failure.
            self.cleanup_errors[directory] = f"旧词典文件暂无法清理：{exc}；关闭占用后重新打开词典管理或重启服务"
        else:
            self.retired.discard(directory)
            self.cleanup_errors.pop(directory, None)

    def remove(self, ident):
        with self.lock:
            if ident not in self.record["installed"]:
                raise KeyError(ident)
            record = json.loads(json.dumps(self.record))
            directory = record["installed"].pop(ident)
            self._write(record)
            instance = self.instances.pop(ident)
            if self.cache and self.cache[0] == instance:
                self.cache = None
            self._retire(directory)

    @contextmanager
    def acquire(self, ident, instance, cancel=None):
        with self.lock:
            if ident not in self.instances:
                raise KeyError(ident)
            if self.instances[ident] != instance:
                raise DictionaryConflict("词典安装实例已变化，请重新选择词典并生成")
            directory = self.record["installed"][ident]
            if self.cache is None or self.cache[0] != instance:
                index = DictionaryIndex(self.root / directory, cancel)
                if index.manifest["id"] != ident:
                    raise ValueError("已安装词典 ID 被修改，请重新导入")
                self.cache = (instance, index)
            index = self.cache[1]
            self.leases[directory] = self.leases.get(directory, 0) + 1
        try:
            yield index
        finally:
            with self.lock:
                self.leases[directory] -= 1
                if not self.leases[directory]:
                    del self.leases[directory]
                    if directory in self.retired:
                        self._retire(directory)
