from server.project_document import initial_project, read_lyrics
from types import SimpleNamespace
import io
import wave
import time

import numpy as np
import pytest

from server.forced import ForcedAlignmentRunner, ForcedUnavailable
from server.projection import project_ttml_for_forced
from server.app import create_app
from server.auth import Settings
from fastapi.testclient import TestClient


def _wav() -> bytes:
    out = io.BytesIO()
    with wave.open(out, "wb") as wav:
        wav.setnchannels(1); wav.setsampwidth(2); wav.setframerate(16000); wav.writeframes(b"\0\0" * 48000)
    return out.getvalue()


def test_forced_projection_keeps_codepoint_ruby_range(tmp_path):
    source = '<tt xmlns="http://www.w3.org/ns/ttml"><body><p xml:id="L"> A <span xmlns:tts="http://www.w3.org/ns/ttml#styling" tts:ruby="container"><span tts:ruby="base">今日</span><span tts:ruby="text">きょう</span></span></p></body></tt>'
    path = tmp_path / "ruby.ttml"; path.write_text(source)
    line = project_ttml_for_forced(path)[0]
    assert line["text"] == " A 今日"
    assert line["reading_spans"][0]["base_start"] == 3
    assert line["reading_spans"][0]["base_end"] == 5


def test_forced_runner_preserves_milliseconds_and_source_range(monkeypatch):
    class FakeAligner:
        def align(self, audio, *, request):
            assert audio.sample_rate == 16_000
            assert request.reading_spans == ()
            return SimpleNamespace(
                backend=SimpleNamespace(name="fake", model_id="m", revision="r", runtime_version="v", precision="fp32"),
                diagnostics=(),
                units=(SimpleNamespace(line_id="L", input_range=(0, 2), text="きょう", start=1.25, end=1.5, granularity="word", confidence=None),),
            )

    from lazulite.models.audio import AudioBuffer
    monkeypatch.setattr("lazulite.audio.io.decode_audio", lambda path: AudioBuffer(np.zeros((1, 32000), dtype=np.float32), 16000, "sha256:x"))
    result = ForcedAlignmentRunner(FakeAligner()).run("clip.wav", {
        "line_id": "L", "text": "きょう", "audio_origin_ms": 1000, "audio_end_ms": 2000,
        "source_range": [7, 9],
    })
    assert result["units"][0]["start_ms"] == 1250
    assert result["units"][0]["source_range"] == [7, 9]
    assert result["evidence"]["units"][0]["end_ms"] == 1500


def test_unconfigured_forced_runner_is_explicitly_unavailable():
    with pytest.raises(ForcedUnavailable):
        ForcedAlignmentRunner().run("clip.wav", {"line_id": "L", "text": "x"})


def test_forced_http_requires_confirmation_and_returns_bound_result(tmp_path):
    class FakeAligner:
        def align(self, audio, *, request):
            assert audio.duration == 1.0
            assert request.audio_origin == 1.0
            unit = SimpleNamespace(line_id="L", input_range=(0, 1), text="歌", start=1.1, end=1.8, granularity="character", confidence=None)
            return SimpleNamespace(backend=SimpleNamespace(name="fake", model_id="m", revision="r", runtime_version="v", precision="fp32"), diagnostics=(), units=(unit,))
    settings = Settings("pw", False, "http://studio")
    client = TestClient(create_app(tmp_path, settings, forced_aligner=FakeAligner()), base_url="https://studio")
    login = client.post("/api/v1/session", json={"password": "pw"}, headers={"origin": settings.origin})
    csrf = login.cookies["studio_csrf"]; headers = {"origin": settings.origin, "x-csrf-token": csrf}
    asset = client.post("/api/v1/assets", files={"file": ("x.wav", _wav(), "audio/wav")}, headers=headers).json()
    project = client.post("/api/v1/projects", json={"name": "x", "source_asset_id": asset["id"]}, headers=headers).json()
    pid = project["id"]
    document = client.get(f"/api/v1/projects/{pid}/document").json(); etag = client.get(f"/api/v1/projects/{pid}/document").headers["etag"]
    ttml = '<tt xmlns="http://www.w3.org/ns/ttml"><body><div begin="1s"><p xml:id="L" begin="0s" end="1s">歌</p></div></body></tt>'
    saved = client.put(f"/api/v1/projects/{pid}/document", json={"schema_version":"studio-document-v4","project_id":pid,"revision":document["revision"],"document":initial_project(ttml, asset["id"])}, headers={**headers,"if-match":etag})
    revision = saved.json()["revision"]
    body = {"revision": revision, "asset_id": asset["id"], "line_id": "L"}
    assert client.post(f"/api/v1/projects/{pid}/jobs/forced_align", json={"params":body}, headers=headers).status_code == 422
    review = client.patch(f"/api/v1/projects/{pid}/review", json={"line_id":"L","confirmed":True,"document_revision":revision}, headers={**headers,"if-match":"0"})
    assert review.status_code == 200
    created = client.post(f"/api/v1/projects/{pid}/jobs/forced_align", json={"params":body}, headers=headers)
    assert created.status_code == 202
    job_id = created.json()["id"]
    for _ in range(30):
        snapshot = client.get(f"/api/v1/jobs/{job_id}").json()
        if snapshot["status"] == "succeeded": break
        time.sleep(0.02)
    assert snapshot["status"] == "succeeded"
    result = client.get(f"/api/v1/jobs/{job_id}/result").json()
    assert result["binding"]["revision"] == revision and result["binding"]["asset_id"] == asset["id"]
    assert result["units"][0]["start_ms"] == 1100
    changed = '<tt xmlns="http://www.w3.org/ns/ttml" xmlns:tts="http://www.w3.org/ns/ttml#styling"><body><div begin="1s"><p xml:id="L" begin="0s" end="1s"><span tts:ruby="container"><span tts:ruby="base">歌</span><span tts:ruby="text">うた</span></span></p></div></body></tt>'
    current = client.get(f"/api/v1/projects/{pid}/document")
    updated = client.put(f"/api/v1/projects/{pid}/document", json={"schema_version":"studio-document-v4","project_id":pid,"revision":current.json()["revision"],"document":initial_project(changed, asset["id"])}, headers={**headers,"if-match":current.headers["etag"]})
    new_body = {"revision": updated.json()["revision"], "asset_id": asset["id"], "line_id": "L", "coordinate_space": "ruby", "ruby_id": "ui-ruby", "base_range": [0, 1]}
    assert client.post(f"/api/v1/projects/{pid}/jobs/forced_align", json={"params":new_body}, headers=headers).status_code == 422
