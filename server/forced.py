"""Explicit, experimental forced-alignment boundary for Studio jobs."""
from __future__ import annotations
from .time_units import milliseconds, time_fields

import os
from pathlib import Path
from typing import Any

from .projection import project_ttml_for_forced


class ForcedUnavailable(RuntimeError):
    pass


def prepare_forced_request(line: dict[str, Any], params: dict[str, Any], *, confirmed: bool, confirmed_revision: str | None, revision: str) -> None:
    """Mutate a job request with server-owned coordinates from one revision line."""
    if not confirmed or confirmed_revision != revision:
        raise ValueError("forced alignment requires a confirmed lyric line at this revision")
    if not line.get("line_id", line.get("id")):
        raise ValueError("forced alignment requires one line_id")
    if line.get("timing_invalid") or line.get("begin") is None or line.get("end") is None:
        raise ValueError("forced alignment requires a timed lyric line")
    params.pop("input_range", None); params.pop("source_range", None)
    params["text"] = line["text"]
    spans = list(line.get("reading_spans", []))
    coordinate_space = params.get("coordinate_space", "text")
    if coordinate_space not in {"text", "ruby"}:
        raise ValueError("coordinate_space must be text or ruby")
    if params.get("input_granularity", "word") not in {"word", "mora", "phoneme"}:
        raise ValueError("unsupported forced alignment granularity")
    if coordinate_space == "ruby":
        ruby_id, base_range = params.get("ruby_id"), params.get("base_range")
        if not ruby_id or not base_range or len(base_range) != 2:
            raise ValueError("注音强制对齐需要明确的注音标识与正文范围")
        matches = [span for span in spans if [span["base_start"], span["base_end"]] == [int(base_range[0]), int(base_range[1])]]
        if len(matches) != 1:
            raise ValueError("注音正文范围无法匹配当前修订中的唯一注音对象")
        params["text"] = matches[0]["reading"]; params["source_range"] = list(base_range)
    params["reading_spans"] = []
    params["audio_origin_ms"] = milliseconds(line["begin"]); params["audio_end_ms"] = milliseconds(line["end"])


class ForcedAlignmentRunner:
    def __init__(self, aligner: Any = None):
        self.aligner = aligner

    @property
    def available(self) -> bool:
        return self.aligner is not None

    @property
    def reason(self) -> str:
        return "未显式配置实验 forced aligner" if self.aligner is None else ""

    def run(self, asset_path: Path, request: dict[str, Any]) -> dict[str, Any]:
        if self.aligner is None:
            raise ForcedUnavailable(self.reason)
        from lazulite.audio.io import decode_audio
        from lazulite.models.alignment import ForcedAlignmentRequest
        from lazulite.models.lyrics import ReadingSpan

        line_id = str(request["line_id"])
        text = str(request["text"])
        start, end = request.get("input_range", [0, len(text)])
        spans = tuple(ReadingSpan(line_id, int(x["base_start"]), int(x["base_end"]), str(x["reading"])) for x in request.get("reading_spans", []))
        forced_request = ForcedAlignmentRequest(
            line_id, text, request.get("language", "ja"), request.get("audio_origin_ms", 0) / 1000,
            (int(start), int(end)), request.get("input_granularity", "word"), spans,
        )
        audio = decode_audio(asset_path)
        origin = request.get("audio_origin_ms", 0) / 1000
        audio_end = None if request.get("audio_end_ms") is None else request["audio_end_ms"] / 1000
        if audio_end is None or not (0 <= origin < float(audio_end) <= audio.duration):
            raise ValueError("forced alignment audio window is outside the decoded asset")
        if audio_end is not None:
            lo = max(0, round(origin * audio.sample_rate))
            hi = round(float(audio_end) * audio.sample_rate)
            audio = type(audio)(audio.samples[:, lo:hi], audio.sample_rate, audio.source_id)
        result = self.aligner.align(audio, request=forced_request)
        units = []
        for unit in result.units:
            item = {
                "line_id": unit.line_id, "input_range": list(unit.input_range), "text": unit.text,
                **time_fields(unit.start,unit.end,start_key="start_ms"),
                "granularity": unit.granularity, "confidence": unit.confidence,
            }
            if request.get("source_range") is not None:
                item["source_range"] = list(request["source_range"])
            units.append(item)
        diagnostics = list(result.diagnostics)
        requested = request.get("input_granularity", "word")
        actual = {item["granularity"] for item in units}
        if actual and any(item != requested for item in actual):
            diagnostics.append(f"requested_granularity_unavailable:{requested};actual={','.join(sorted(actual))}")
        return {
            "kind": "forced_align", "timing_source": "forced_alignment", "units": units,
            "requested_granularity": requested, "diagnostics": diagnostics,
            "evidence": {"backend": result.backend.name, "model_id": result.backend.model_id,
                         "revision": result.backend.revision, "request": {
                             "line_id": line_id, "text": text, "input_range": [int(start), int(end)],
                             "reading_spans": request.get("reading_spans", []), "audio_origin_ms": request.get("audio_origin_ms", 0),
                             "audio_end_ms": request.get("audio_end_ms"), "coordinate_space": request.get("coordinate_space", "text"),
                             "ruby_id": request.get("ruby_id"), "source_range": request.get("source_range"),
                         }, "units": units},
            "engine": {"name": result.backend.name, "model_id": result.backend.model_id,
                       "revision": result.backend.revision, "runtime_version": result.backend.runtime_version,
                       "precision": result.backend.precision},
        }


def configured_forced_runner() -> ForcedAlignmentRunner:
    backend = os.getenv("LAZULITE_FORCED_BACKEND", "").lower()
    model_path = os.getenv("LAZULITE_FORCED_MODEL_PATH")
    if backend != "qwen" or not model_path:
        return ForcedAlignmentRunner()
    try:
        from lazulite.alignment.forced.qwen import QwenForcedAligner, QwenForcedAlignmentConfig
        return ForcedAlignmentRunner(QwenForcedAligner(QwenForcedAlignmentConfig(
            Path(model_path), os.getenv("LAZULITE_FORCED_MODEL_ID", model_path),
            os.getenv("LAZULITE_FORCED_MODEL_REVISION", "configured"),
            device_map=os.getenv("LAZULITE_FORCED_DEVICE", "cuda:0"),
        )))
    except Exception as exc:
        raise RuntimeError(f"configured forced aligner unavailable: {type(exc).__name__}") from exc
