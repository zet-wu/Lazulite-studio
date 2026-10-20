"""Assemble editable dictionaries from one explicitly selected public Release."""
import json
import subprocess
import urllib.request
from pathlib import Path
from urllib.parse import quote


def assemble(root, python, specification):
    spec = json.loads(Path(specification).read_text("utf-8"))
    target = root / "resources/dictionaries"
    target.mkdir(parents=True)
    for asset in spec["assets"]:
        url = f"https://github.com/{spec['repository']}/releases/download/{quote(spec['release'], safe='')}/{quote(asset['name'], safe='')}"
        path = target / asset["name"]
        # Download on every assembly. Source version selects an asset; there is
        # deliberately no content fingerprint, including in portable manifests.
        with urllib.request.urlopen(url, timeout=120) as response, path.open("wb") as out:
            size = 0
            while chunk := response.read(1024 * 1024):
                size += len(chunk)
                if size > 128 * 1024 * 1024:
                    raise ValueError("词典压缩包超过下载资源限制")
                out.write(chunk)
        subprocess.run([str(python), "-I", "-c",
            "import sys,tempfile;sys.path.insert(0,sys.argv[1]);"
            "from server.dictionary_format import extract_package,read_directory;"
            "tmp=tempfile.TemporaryDirectory();extract_package(sys.argv[2],tmp.name);"
            "manifest,sources,entries=read_directory(tmp.name);"
            "assert manifest['id']==sys.argv[3];print(manifest['id'],sum(1 for _ in entries));tmp.cleanup()",
            str(root / "app"), str(path), asset["id"]], check=True)
    (root / "licenses/dictionary-sources.json").write_text(json.dumps(spec, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
