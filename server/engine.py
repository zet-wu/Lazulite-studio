"""Lazulite task boundary.  Network lyric providers are real by default; model
backends are deliberately injected so an unconfigured installation reports a
capability error instead of returning fabricated transcription."""
from __future__ import annotations

from pathlib import Path
import os
from typing import Any, Callable
from importlib.metadata import version, PackageNotFoundError
import hashlib


class EngineUnavailable(RuntimeError):
    pass


class LazuliteEngine:
    def __init__(self, transcriber: Any = None,
                 provider_factory: Callable[[], Any] | None = None):
        self.transcriber = transcriber
        self.provider_factory = provider_factory

    def identity(self) -> dict[str, str]:
        source_hash = "unknown"
        try:
            import lazulite
            digest = hashlib.sha256()
            for path in sorted(Path(lazulite.__file__).parent.rglob("*.py")):
                digest.update(path.read_bytes())
            source_hash = digest.hexdigest()[:16]
        except Exception:
            pass
        try:
            build = version("lazulite")
        except PackageNotFoundError:
            build = "local"
        if self.transcriber is not None:
            info = getattr(self.transcriber, "info", None)
            if info:
                return {"name": info.name, "build": build, "source_hash": source_hash, "model_id": info.model_id,
                        "revision": info.revision, "runtime_version": info.runtime_version,
                        "precision": info.precision}
        return {"name": "lazulite", "build": build, "source_hash": source_hash, "model_id": "unconfigured", "revision": "unknown",
                "runtime_version": "unknown", "precision": "unknown"}

    def run(self, kind: str, *, asset_path: Path, params: dict[str, Any], emit):
        from lazulite.audio.io import read_audio_metadata
        from lazulite.lyrics.service import search_lyrics, fetch_lyrics
        providers = self.provider_factory() if self.provider_factory else None
        emit("stage", "prepare", 0, 1, "读取音频元数据")
        metadata = read_audio_metadata(asset_path)
        # UI metadata edits are explicit task input; never infer a title from a
        # content hash when the original file had no readable tags.
        if any(key in params for key in ("title", "artist", "album")):
            from dataclasses import replace
            metadata = replace(metadata, title=params.get("title") or metadata.title,
                               artist=params.get("artist", metadata.artist),
                               album=params.get("album", metadata.album))
        if kind in {"search", "lyrics.search"}:
            rows = search_lyrics(metadata, providers=providers,
                                 per_provider_limit=int(params.get("per_provider_limit", 3)))
            return {"kind": "search", "asset": {"title": metadata.title, "artist": metadata.artist,
                    "album": metadata.album, "duration": metadata.duration},
                    "items": [self._candidate(x) for x in rows], "engine": self.identity()}
        if kind in {"fetch", "lyrics.fetch"}:
            raw = params.get("candidates", [])
            from lazulite.lyrics.providers.base import SearchCandidate
            candidates = [SearchCandidate(**x) for x in raw]
            rows = fetch_lyrics(candidates, providers=providers)
            return {"kind": "fetch", "items": [self._fetched(x) for x in rows], "engine": self.identity()}
        if kind in {"transcribe", "line_align", "align"}:
            if self.transcriber is None:
                raise EngineUnavailable("未配置可用模型后端；请在服务启动时注入 transcriber")
            from lazulite.audio.io import decode_audio
            from lazulite.audio.activity import analyze_vocals
            from lazulite.models.audio import VocalSegment
            from lazulite.transcription.base import TranscriptionRequest
            audio = decode_audio(asset_path)
            analysis = analyze_vocals(audio)
            emit("stage", "transcribe", 0, len(analysis.segments), "调用转写后端")
            transcription = __import__("lazulite.transcription.run", fromlist=["transcribe_segments"]).transcribe_segments(
                audio, analysis.segments, transcriber=self.transcriber,
                request=TranscriptionRequest(language=params.get("language"), include_timing=True))
            output = {"kind": "transcribe", "engine": self.identity(), "segments": [
                {"source_segment_id": x.source_segment_id, "text": x.text, "language": x.language,
                 "start": x.start, "end": x.end,
                 "begin_us": round(x.start * 1_000_000) if x.start is not None else None,
                 "end_us": round(x.end * 1_000_000) if x.end is not None else None,
                 "confidence": x.confidence,
                 "confidence_kind": x.confidence_kind,
                 "timed_text": [{"text": t.text, "start": t.start, "end": t.end,
                                 "granularity": t.granularity, "source": t.source} for t in x.timed_text]}
                for x in transcription.segments], "diagnostics": list(analysis.diagnostics)}
            if kind in {"line_align", "align"}:
                from lazulite.models.lyrics import LyricDocument, LyricLine
                from lazulite.alignment.line import align_lines
                lines = tuple(LyricLine(str(x["id"]), str(x["text"])) for x in params.get("lines", []))
                if not lines:
                    raise ValueError("行对齐需要服务端从 revision 投影出的 lines")
                aligned = align_lines(LyricDocument(lines), transcription, analysis)
                output["kind"] = "line_align"
                output["lines"] = [{"line_id": x.line_id, "start": x.start, "end": x.end,
                    "begin_us": round(x.start * 1_000_000) if x.start is not None else None,
                    "end_us": round(x.end * 1_000_000) if x.end is not None else None,
                    "similarity": x.similarity, "score": x.score, "timing_source": x.timing_source,
                    "source_segment_ids": list(x.source_segment_ids), "issues": list(x.issues)} for x in aligned.lines]
                output["reliable"] = aligned.reliable
            return output
        raise ValueError(f"unsupported job kind: {kind}")

    @staticmethod
    def _candidate(x):
        return {"source": x.source, "candidate_id": x.candidate_id, "title": x.title,
                "artist": x.artist, "album": x.album, "duration": x.duration,
                "match_score": x.match_score, "raw": x.raw}

    def _fetched(self, x):
        return {"candidate": self._candidate(x.candidate), "provider_rank": x.provider_rank,
                "line_count": x.lyric_line_count,
                "lines": [{"id": l.id, "text": l.text, "start": l.source_start, "end": l.source_end}
                          for l in x.lyrics.document.lines]}

def configured_engine() -> LazuliteEngine:
    """Construct an explicitly configured model lazily at service startup."""
    backend = os.getenv("LAZULITE_TRANSCRIBER", "").lower()
    model_path = os.getenv("LAZULITE_MODEL_PATH")
    if not backend or not model_path:
        return LazuliteEngine()
    model_id = os.getenv("LAZULITE_MODEL_ID", model_path)
    revision = os.getenv("LAZULITE_MODEL_REVISION", "configured")
    try:
        if backend == "whisper":
            from lazulite.transcription.backends.whisper import WhisperBackend, WhisperConfig
            transcriber = WhisperBackend(WhisperConfig(Path(model_path), model_id, revision,
                device=os.getenv("LAZULITE_DEVICE", "cuda")))
        elif backend == "qwen":
            from lazulite.transcription.backends.qwen import QwenBackend, QwenConfig
            transcriber = QwenBackend(QwenConfig(Path(model_path), model_id, revision,
                device_map=os.getenv("LAZULITE_DEVICE", "cuda:0")))
        else:
            raise ValueError("LAZULITE_TRANSCRIBER must be whisper or qwen")
    except Exception as exc:
        raise RuntimeError(f"configured Lazulite backend unavailable: {type(exc).__name__}") from exc
    return LazuliteEngine(transcriber=transcriber)
