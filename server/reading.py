"""Active, stateless Japanese reading analysis for the Ruby editor."""
from __future__ import annotations
from io import StringIO

from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
from pathlib import Path
import sqlite3
from typing import Any, Mapping, Protocol, Sequence
import uuid
from threading import Lock

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from .furigana import load_index, token_segments


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _proposal_id(line_id: str, start: int, end: int, base: str, reading: str) -> str:
    value = f"{line_id}\0{start}\0{end}\0{base}\0{reading}".encode()
    return "reading-" + hashlib.sha256(value).hexdigest()[:24]


@dataclass(frozen=True, slots=True)
class ReadingProposal:
    line_id: str
    proposal_id: str
    base_start: int
    base_end: int
    base: str
    reading: str
    source: str
    needs_review: bool

    def as_dict(self) -> dict[str, Any]:
        return {
            "line_id": self.line_id,
            "proposal_id": self.proposal_id,
            "base_start": self.base_start,
            "base_end": self.base_end,
            "base": self.base,
            "reading": self.reading,
            "source": self.source,
            "needs_review": self.needs_review,
        }


class ReadingProposer(Protocol):
    def propose(self, lines: Sequence[Mapping[str, str]], dictionary: Mapping[str, str]) -> Sequence[ReadingProposal | Mapping[str, Any]]:
        """Return whole-word proposals using code-point offsets in each line."""


def _hiragana(reading: str) -> str:
    return "".join(chr(ord(char) - 0x60) if "ァ" <= char <= "ヶ" else char for char in reading)


def _contains_japanese(text: str) -> bool:
    return any(
        "ぁ" <= char <= "ゖ" or "ァ" <= char <= "ヺ" or "一" <= char <= "龯"
        for char in text
    )


class SudachiReadingProposer:
    """Sudachi-backed proposer. Importing this module does not load the dictionary."""

    def __init__(self) -> None:
        self._tokenizer = None
        self._tokenizer_lock = Lock()
        self.unavailable_reason: str | None = None
        try:
            from sudachipy import dictionary, tokenizer

            self._tokenizer = dictionary.Dictionary().create()
            self._mode = tokenizer.Tokenizer.SplitMode.C
            self._mode_a = tokenizer.Tokenizer.SplitMode.A
            self._furigana = load_index()
        except Exception as exc:  # dependency/model data can be absent on a server
            self._tokenizer = None
            self.unavailable_reason = f"日文读音资源不可用：{type(exc).__name__}: {exc}"

    @property
    def available(self) -> bool:
        return self._tokenizer is not None

    def propose(self, lines: Sequence[Mapping[str, str]], dictionary: Mapping[str, str]) -> Sequence[ReadingProposal]:
        if self._tokenizer is None:
            raise ReadingUnavailable(self.unavailable_reason or "SudachiPy 不可用")
        output: list[ReadingProposal] = []
        for line in lines:
            line_id, text = str(line["id"]), str(line.get("text", ""))
            with self._tokenizer_lock:
                # Keep token reads and split(A) inside the tokenizer lock too.
                for token in self._tokenizer.tokenize(text, self._mode):
                    override = dictionary.get(token.surface())
                    segments = [(token.begin(), token.end(), token.surface(), _hiragana(override))] if override else token_segments(token, self._furigana, self._mode_a, _hiragana)
                    for start, end, base, reading in segments:
                        if not _contains_japanese(base) or not reading or reading == '*' or _hiragana(base) == reading:
                            continue
                        output.append(ReadingProposal(
                            line_id=line_id, proposal_id=_proposal_id(line_id, start, end, base, reading),
                            base_start=start, base_end=end, base=base, reading=reading,
                            source='dictionary' if override else 'sudachi', needs_review=not bool(override),
                        ))
        return output


class ReadingUnavailable(RuntimeError):
    pass


def _coerce_proposal(value: ReadingProposal | Mapping[str, Any], lines: Mapping[str, str]) -> ReadingProposal:
    data = value.as_dict() if isinstance(value, ReadingProposal) else dict(value)
    line_id = str(data["line_id"])
    if line_id not in lines:
        raise ValueError("proposal line does not belong to revision")
    text = lines[line_id]
    start, end = int(data["base_start"]), int(data["base_end"])
    base = str(data.get("base", text[start:end]))
    reading = str(data["reading"])
    if not reading or start < 0 or end <= start or end > len(text) or text[start:end] != base:
        raise ValueError("proposal range does not match line text")
    return ReadingProposal(
        line_id=line_id,
        proposal_id=str(data.get("proposal_id") or _proposal_id(line_id, start, end, base, reading)),
        base_start=start,
        base_end=end,
        base=base,
        reading=reading,
        source=str(data.get("source") or "sudachi"),
        needs_review=bool(data.get("needs_review", True)),
    )


def propose_readings(lines: Sequence[Mapping[str, str]], proposer: ReadingProposer, dictionary: Mapping[str, str]) -> list[ReadingProposal]:
    texts = {str(line["id"]): str(line.get("text", "")) for line in lines}
    return [_coerce_proposal(item, texts) for item in proposer.propose(lines, dictionary)]


class ReadingLine(BaseModel):
    id: str = Field(min_length=1, max_length=200)
    text: str = Field(max_length=100000)


class ReadingSnapshot(BaseModel):
    lines: list[ReadingLine] = Field(min_length=1, max_length=10000)


class ReadingRange(BaseModel):
    line_id: str
    base_start: int
    base_end: int
    base: str
    reading: str


class ReadingAnalysis(BaseModel):
    ranges: list[ReadingRange]


def analyze_snapshot(body: ReadingSnapshot, proposer: ReadingProposer) -> ReadingAnalysis:
    """Analyze current text, with explicit empty readings for every uncovered range."""
    lines = [line.model_dump() for line in body.lines]
    if len({line.id for line in body.lines}) != len(lines):
        raise ValueError('行标识重复')
    if sum(len(line.text) for line in body.lines) > 1000000:
        raise ValueError('本次正文过长，请减少所选行')
    proposals = propose_readings(lines, proposer, {})
    ranges = []
    for line in body.lines:
        offset = 0
        for item in sorted((p for p in proposals if p.line_id == line.id), key=lambda p: p.base_start):
            if item.base_start < offset:
                raise ValueError('读音分析范围重叠')
            if offset < item.base_start:
                ranges.append(ReadingRange(line_id=line.id, base_start=offset, base_end=item.base_start, base=line.text[offset:item.base_start], reading=''))
            # Unknown dictionary forms may repeat the original ideographs; never label those a reading.
            reading = item.reading if all('ぁ' <= c <= 'ゖ' or c in 'ー゙゚' for c in item.reading) else ''
            ranges.append(ReadingRange(line_id=line.id, base_start=item.base_start, base_end=item.base_end, base=item.base, reading=reading))
            offset = item.base_end
        if offset < len(line.text):
            ranges.append(ReadingRange(line_id=line.id, base_start=offset, base_end=len(line.text), base=line.text[offset:], reading=''))
    return ReadingAnalysis(ranges=ranges)


def build_analysis_router(proposer: ReadingProposer, *, write) -> APIRouter:
    router = APIRouter()

    @router.post('/reading/analyze', response_model=ReadingAnalysis)
    def analyze(body: ReadingSnapshot, _: object = Depends(write)):
        try:
            return analyze_snapshot(body, proposer)
        except ReadingUnavailable as exc:
            raise HTTPException(503, {'code': 'reading_unavailable', 'message': str(exc), 'retryable': True}) from exc
        except ValueError as exc:
            raise HTTPException(422, {'code': 'reading_invalid', 'message': str(exc), 'retryable': False}) from exc

    return router
