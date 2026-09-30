from __future__ import annotations

import subprocess
from pathlib import Path
import pytest

from server.publishing import extract_stpp, publish_stpp


TTML = b'''<?xml version="1.0" encoding="UTF-8"?>
<tt xmlns="http://www.w3.org/ns/ttml"><body><p begin="0s" end="1s">hello</p></body></tt>
'''


def _m4a(path: Path, codec: str = "aac", faststart: bool = False) -> None:
    flags = ["-movflags", "+faststart"] if faststart else []
    subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-metadata", "title=Publisher test", "-metadata", "artist=Studio", "-c:a", codec, *flags, str(path)],
        check=True,
    )


def _pcm_hash(path: Path) -> str:
    result = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(path), "-map", "0:a:0", "-f", "hash", "-hash", "sha256", "-"],
        check=True, capture_output=True, text=True,
    )
    return result.stdout.strip()


@pytest.mark.parametrize("codec,faststart", [("aac", False), ("aac", True), ("alac", False), ("alac", True)])
def test_publish_adds_one_stpp_sample_and_preserves_audio_metadata(tmp_path: Path, codec: str, faststart: bool) -> None:
    source, output = tmp_path / "source.m4a", tmp_path / "published.m4a"
    _m4a(source, codec, faststart)
    report = publish_stpp(source, TTML, output)

    assert report.subtitle_handler == "subt"
    assert report.subtitle_codec == "stpp"
    assert report.sample_count == 1
    assert report.audio_streams == 1
    assert report.metadata_preserved
    assert extract_stpp(output) == TTML
    assert _pcm_hash(source) == _pcm_hash(output)

    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-of", "json", "-show_streams", str(output)],
        check=True,
        capture_output=True,
        text=True,
    )
    # FFmpeg 5.1 exposes this valid stpp track as a data stream, but retains
    # the ISO sample-entry tag; the independent box reader verifies handler.
    assert '"codec_tag_string": "stpp"' in probe.stdout


def test_publish_rejects_malformed_ttml(tmp_path: Path) -> None:
    source = tmp_path / "source.m4a"
    _m4a(source)
    try:
        publish_stpp(source, b"<tt>", tmp_path / "out.m4a")
    except ValueError as error:
        assert "well-formed" in str(error)
    else:
        raise AssertionError("malformed TTML was accepted")


def test_publish_rejects_existing_stpp(tmp_path: Path) -> None:
    source, first, second = tmp_path / "source.m4a", tmp_path / "first.m4a", tmp_path / "second.m4a"
    _m4a(source)
    publish_stpp(source, TTML, first)
    try:
        publish_stpp(first, TTML, second)
    except ValueError as error:
        assert "select an existing" in str(error)
    else:
        raise AssertionError("existing stpp track was accepted")
