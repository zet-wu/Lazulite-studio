"""Session-scoped synthetic media fixtures shared across packaging/publishing tests."""
from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import pytest


@pytest.fixture(scope="session")
def synthetic_audio(tmp_path_factory):
    cache_dir = tmp_path_factory.mktemp("synthetic-audio")
    cache: dict[tuple[str, str, bool, bool], Path] = {}

    def get(
        destination: Path | None = None,
        *,
        codec: str = "aac",
        extension: str = "m4a",
        faststart: bool = False,
        with_metadata: bool = False,
    ) -> Path:
        key = (codec, extension, faststart, with_metadata)
        cached = cache.get(key)
        if cached is None:
            cached = cache_dir / f"{codec}-{int(faststart)}-{int(with_metadata)}.{extension}"
            cmd = [
                "ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i",
                "sine=frequency=440:duration=1",
            ]
            if with_metadata:
                cmd.extend(["-metadata", "title=Publisher test", "-metadata", "artist=Studio"])
            cmd.extend(["-c:a", codec])
            if faststart:
                cmd.extend(["-movflags", "+faststart"])
            cmd.append(str(cached))
            subprocess.run(cmd, check=True)
            cache[key] = cached
        if destination is None:
            return cached
        shutil.copyfile(cached, destination)
        return destination

    return get
