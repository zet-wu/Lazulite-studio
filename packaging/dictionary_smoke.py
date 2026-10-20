"""Exercise actual bundled dictionaries on the build's Windows/macOS runtime."""
import json
import sys
import tempfile
from pathlib import Path


def smoke(root):
    sys.path.insert(0, str(root / "app"))
    from server.dictionaries import Dictionaries
    with tempfile.TemporaryDirectory() as tmp:
        data = Path(tmp) / "library"
        manager = Dictionaries(data, root / "resources/dictionaries")
        if manager.default_errors:
            raise RuntimeError("; ".join(manager.default_errors))
        assert set(manager.instances) == {"zh-pinyin", "yue-jyutping"}
        results = {}
        for ident, instance in list(manager.instances.items()):
            with manager.acquire(ident, instance) as index:
                values = index.analyze("重庆人民")
                assert any(r["units"] for r in values)
                results[ident] = {"version": index.manifest["version"], "entries": index.count, "ranges": values}
        # Same-version replacement while an old query holds the previous index.
        ident = "yue-jyutping"
        package = next((root / "resources/dictionaries").glob("yue-jyutping-*.zip"))
        old_instance = manager.instances[ident]
        with manager.acquire(ident, old_instance) as old:
            manager.install(package, replace=True)
            assert old.analyze("重庆")
        assert manager.instances[ident] != old_instance
        manager.remove(ident)
        # Service-stopped text edits are accepted without changing the version.
        directory = data / manager.record["installed"]["zh-pinyin"]
        entry = {"surface": "重庆", "candidates": [{"id": "edited", "priority": 0,
                 "segments": [{"base": "重庆", "annotate": True, "units": ["edited"]}]}], "cost": 1}
        (directory / "entries.jsonl").write_text(json.dumps(entry, ensure_ascii=False) + "\n", encoding="utf-8")
        moved = data.with_name("moved-library")
        data.rename(moved)
        restarted = Dictionaries(moved, root / "resources/dictionaries")
        assert ident not in restarted.instances
        with restarted.acquire("zh-pinyin", restarted.instances["zh-pinyin"]) as index:
            assert index.analyze("重庆")[0]["units"] == ["edited"]
        return results


if __name__ == "__main__":
    print(json.dumps(smoke(Path(sys.argv[1]).resolve()), ensure_ascii=False, indent=2))
