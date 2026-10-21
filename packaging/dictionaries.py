"""Assemble editable dictionaries from one explicitly selected public Release."""
import json
import urllib.request
from pathlib import Path
from urllib.parse import quote


def assemble(root, specification):
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
        # The following runtime smoke installs through Studio's normal boundary
        # validator. Do not scan every entry a second time in the downloader.
    (root / "licenses/dictionary-sources.json").write_text(json.dumps(spec, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
