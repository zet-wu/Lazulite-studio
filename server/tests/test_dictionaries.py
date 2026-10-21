import io
import json
import shutil
import threading
import zipfile

import pytest
from fastapi.testclient import TestClient

from server.app import create_app
from server.auth import Settings
from server.dictionaries import Dictionaries, DictionaryConflict
from server.dictionary_engine import AnalysisCancelled


def entry(surface, *readings, cost=None):
    return {"surface": surface, **({"cost": cost} if cost is not None else {}),
            "candidates": [{"id": str(i), "priority": 0, "segments": [{"base": surface, "annotate": True, "units": reading.split("|")}]}
                           for i, reading in enumerate(readings)]}


def package(entries=None, *, ident="custom", weighted=False, extra=None):
    manifest = {"id": ident, "version": "1", "formatVersion": 1, "name": "自定义读音",
                "language": "custom", "region": "自定义", "notation": "固定音节",
                "entries": "entries.jsonl", "readingPolicy": "fixed",
                "scoring": {"mode": "weighted", "unknownCost": 100} if weighted else {"mode": "uniform"}}
    contents = {"manifest.json": json.dumps(manifest), "sources.json": '{"author":"fixture"}',
                "licenses/NOTICE.txt": "Independent test fixture; CC0.",
                "entries.jsonl": "\n".join(json.dumps(e, ensure_ascii=False) for e in (entries or [entry("重庆", "chóng|qìng")]))}
    contents.update(extra or {})
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, "w") as z:
        for name, value in contents.items():
            z.writestr(name, value)
    stream.seek(0)
    return stream


def test_edit_same_version_instances_leases_and_restart(tmp_path):
    manager = Dictionaries(tmp_path)
    first = manager.install(package())
    with manager.acquire("custom", first["instance"]) as old:
        folder = manager.record["installed"]["custom"]
        second = manager.install(package([entry("重庆", "手改")]), replace=True)
        assert old.analyze("重庆")[0]["units"] == ["chóng", "qìng"]
        assert (tmp_path / folder).exists()
        with pytest.raises(DictionaryConflict):
            with manager.acquire("custom", first["instance"]):
                pass
    assert not (tmp_path / folder).exists()
    with manager.acquire("custom", second["instance"]) as index:
        assert index.analyze("重庆")[0]["units"] == ["手改"]
    folder = tmp_path / manager.record["installed"]["custom"]
    (folder / "entries.jsonl").write_text(json.dumps(entry("重庆", "停止服务后修改"), ensure_ascii=False))
    restarted = Dictionaries(tmp_path)
    assert restarted.instances["custom"] != second["instance"]
    with restarted.acquire("custom", restarted.instances["custom"]) as index:
        assert index.analyze("重庆")[0]["units"] == ["停止服务后修改"]
    moved = tmp_path.parent / "moved"
    shutil.copytree(tmp_path, moved)
    moved_manager = Dictionaries(moved)
    with moved_manager.acquire("custom", moved_manager.instances["custom"]) as index:
        assert index.count == 1
    moved_manager.remove("custom")
    assert moved_manager.list()["dictionaries"] == []


@pytest.mark.parametrize("extra", [
    {"../escape": "bad"}, {"entries.jsonl": "{"}, {"entries.jsonl": json.dumps(entry("重 庆", "bad"))},
    {"entries.jsonl": json.dumps({**entry("重庆", "good"), "cost": 1})},
    {"manifest.json": '{"formatVersion":2}'}, {"Manifest.json": "{}"},
    {"entries.jsonl": json.dumps(entry("重庆", ""))},
])
def test_invalid_import_preserves_installed_instance(tmp_path, extra):
    manager = Dictionaries(tmp_path)
    first = manager.install(package())
    with pytest.raises((ValueError, zipfile.BadZipFile)):
        manager.install(package(extra=extra), replace=True)
    assert manager.instances["custom"] == first["instance"]
    assert len(list(tmp_path.iterdir())) == 2


def test_duplicate_zip_key_and_grapheme_boundary_rejected(tmp_path):
    manager = Dictionaries(tmp_path)
    data = package()
    with zipfile.ZipFile(data, "a") as z:
        with pytest.warns(UserWarning):
            z.writestr("manifest.json", "{}")
    data.seek(0)
    with pytest.raises(ValueError, match="重复"):
        manager.install(data)
    e = entry("漢\U000e0100", "kan")
    e["candidates"][0]["segments"] = [{"base": "漢", "annotate": True, "units": ["kan"]},
                                     {"base": "\U000e0100", "annotate": False, "units": []}]
    with pytest.raises(ValueError, match="字素"):
        manager.install(package([e]))


def test_defaults_user_edits_and_removal_survive_restart(tmp_path):
    defaults, root = tmp_path / "defaults", tmp_path / "data"
    defaults.mkdir()
    (defaults / "custom.zip").write_bytes(package([entry("重庆", "修改过的携带包")]).getvalue())
    manager = Dictionaries(root, defaults)
    with manager.acquire("custom", manager.instances["custom"]) as index:
        assert index.analyze("重庆")[0]["units"] == ["修改过的携带包"]
    manager.remove("custom")
    assert not Dictionaries(root, defaults).instances


def test_optimal_paths_local_ambiguity_candidates_and_boundaries(tmp_path):
    manager = Dictionaries(tmp_path)
    known = entry("重庆", "chóng|qìng")
    known["candidates"][0]["segments"] = [
        {"base": "重", "annotate": True, "units": ["chóng"]},
        {"base": "庆", "annotate": True, "units": ["qìng"]},
    ]
    second = json.loads(json.dumps(known["candidates"][0]))
    second.update(id="other")
    second["segments"][1]["units"] = ["Q"]
    known["candidates"].append(second)
    installed = manager.install(package([known, entry("甲乙", "A"), entry("乙丙", "B"), entry("甲", "a"), entry("丙", "c")]))
    with manager.acquire("custom", installed["instance"]) as index:
        values = index.analyze("重庆甲乙丙👩‍👩‍👧‍👦，重 庆")
        assert [(r["base"], r["status"]) for r in values[:4]] == [
            ("重", "known"), ("庆", "ambiguous"), ("甲乙丙", "ambiguous"), ("👩‍👩‍👧‍👦", "unknown")]
        assert "".join(r["base"] for r in values) == "重庆甲乙丙👩‍👩‍👧‍👦，重 庆"
        assert not any(r["base"] == "重庆" for r in values)
        cancel = threading.Event()
        cancel.set()
        with pytest.raises(AnalysisCancelled):
            index.analyze("重庆", cancel)
    # Same output across alternate word paths is not an ambiguity.
    entries = [entry("甲乙", "a|b"), entry("乙丙", "b|c"), entry("甲", "a"), entry("丙", "c")]
    for e in entries[:2]:
        e["candidates"][0]["segments"] = [{"base": c, "annotate": True, "units": [u]} for c,u in zip(e["surface"], e["candidates"][0]["segments"][0]["units"])]
    second = manager.install(package(entries), replace=True)
    with manager.acquire("custom", second["instance"]) as index:
        assert [r["units"] for r in index.analyze("甲乙丙")] == [["a"], ["b"], ["c"]]


def test_http_contract_inspect_replace_auth_and_stale_request(tmp_path):
    app = create_app(tmp_path, Settings(None, True, "http://studio"))
    with TestClient(app) as client:
        headers = {"origin": "http://studio"}
        endpoint = "/api/v1/reading/dictionaries"
        assert client.post(endpoint+"/import", files={"file": ("custom.zip", package())}).status_code == 403
        inspected = client.post(endpoint+"/import?inspect=true", headers=headers, files={"file": ("custom.zip", package())})
        assert inspected.status_code == 200 and not inspected.json()["replaceRequired"]
        assert client.get(endpoint).json()["dictionaries"] == []
        installed = client.post(endpoint+"/import", headers=headers, files={"file": ("custom.zip", package())}).json()
        body = {"instance": installed["instance"], "lines": [{"id": "line", "text": "𝄞重庆"}]}
        analysis = client.post(endpoint+"/custom/analyze", headers=headers, json=body)
        assert analysis.status_code == 200
        assert analysis.json()["ranges"][1] == {"line_id": "line", "base_start": 1, "base_end": 3, "base": "重庆", "status": "known", "units": ["chóng", "qìng"]}
        client.post(endpoint+"/import?replace=true", headers=headers, files={"file": ("custom.zip", package())})
        assert client.post(endpoint+"/custom/analyze", headers=headers, json=body).status_code == 409
        assert client.delete(endpoint+"/custom", headers=headers).status_code == 204
        assert client.post(endpoint+"/custom/analyze", headers=headers, json=body).status_code == 404


def test_weighted_paths_and_priority_are_independent_of_file_order(tmp_path):
    entries = [entry("研究生", "graduate", cost=50), entry("研究", "research", cost=1),
               entry("生命", "life", cost=1), entry("命", "fate", cost=50), entry("起源", "origin", cost=1),
               entry("重", "zhòng", "chóng", cost=1)]
    entries[-1]["candidates"][1]["priority"] = 1
    manager = Dictionaries(tmp_path)
    for records in [entries, list(reversed(entries))]:
        info = manager.install(package(records, weighted=True), replace=True)
        with manager.acquire("custom", info["instance"]) as index:
            assert [r["base"] for r in index.analyze("研究生命起源")] == ["研究", "生命", "起源"]
            assert index.analyze("研究生命起源", mode="uniform")[0]["status"] == "ambiguous"
            assert index.analyze("重")[0]["units"] == ["chóng"]


def test_atomic_record_failure_and_corrupt_installed_content_are_explicit(tmp_path, monkeypatch):
    manager = Dictionaries(tmp_path)
    first = manager.install(package())
    cached = manager.cache
    def fail(*_):
        raise OSError("disk write failed")
    with monkeypatch.context() as patch:
        patch.setattr("server.dictionaries.write_atomic", fail)
        with pytest.raises(OSError, match="disk write"):
            manager.install(package([entry("重庆", "new")]), replace=True)
    assert manager.instances["custom"] == first["instance"]
    assert len(list(tmp_path.iterdir())) == 2
    assert manager.cache is cached
    path = tmp_path / manager.record["installed"]["custom"] / "entries.jsonl"
    path.write_text("{")
    restarted = Dictionaries(tmp_path)
    with pytest.raises(ValueError):
        with restarted.acquire("custom", restarted.instances["custom"]):
            pass


def test_archive_resource_limit_rejects_before_publish(tmp_path, monkeypatch):
    manager = Dictionaries(tmp_path)
    first = manager.install(package())
    monkeypatch.setattr("server.dictionary_format.MAX_BYTES", 16)
    with pytest.raises(ValueError, match="资源限制"):
        manager.install(package(), replace=True)
    assert manager.instances["custom"] == first["instance"]


def test_locked_retired_files_do_not_undo_publication_and_cleanup_retries(tmp_path, monkeypatch):
    manager = Dictionaries(tmp_path)
    manager.install(package())
    old = tmp_path / manager.record["installed"]["custom"]
    original = shutil.rmtree
    def locked(path, *args, **kwargs):
        if path == old:
            raise PermissionError("file is in use")
        return original(path, *args, **kwargs)
    with monkeypatch.context() as patch:
        patch.setattr(shutil, "rmtree", locked)
        second = manager.install(package([entry("重庆", "updated")]), replace=True)
        assert manager.list()["errors"]
        with manager.acquire("custom", second["instance"]) as index:
            assert index.analyze("重庆")[0]["units"] == ["updated"]
        assert old.exists()
    assert not manager.list()["errors"]
    assert not old.exists()

def test_inspect_reads_metadata_only_and_install_reuses_index(tmp_path, monkeypatch):
    manager = Dictionaries(tmp_path)
    original = zipfile.ZipFile.read
    def metadata_only(z, name, *args, **kwargs):
        assert name in ("manifest.json", "sources.json")
        return original(z, name, *args, **kwargs)
    with monkeypatch.context() as patch:
        patch.setattr(zipfile.ZipFile, "read", metadata_only)
        info = manager.install(package(extra={"entries.jsonl": "invalid"}), inspect=True)
        assert info["entryCount"] is None and not manager.instances
    first = manager.install(package())
    cached = manager.cache[1]
    def no_rebuild(*args, **kwargs):
        raise AssertionError("installed index should be reused")
    monkeypatch.setattr("server.dictionaries.DictionaryIndex", no_rebuild)
    with manager.acquire("custom", first["instance"]) as index:
        assert index is cached
