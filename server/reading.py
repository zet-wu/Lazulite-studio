"""Japanese reading proposals and the small project dictionary store."""
from __future__ import annotations
from io import StringIO
from .project_document import read_lyrics

from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
from pathlib import Path
import sqlite3
from typing import Any, Mapping, Protocol, Sequence
import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from .db import Database
from .projection import project_ttml


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
        self.unavailable_reason: str | None = None
        try:
            from sudachipy import dictionary, tokenizer

            self._tokenizer = dictionary.Dictionary().create()
            self._mode = tokenizer.Tokenizer.SplitMode.C
        except Exception as exc:  # dependency/model data can be absent on a server
            self.unavailable_reason = f"SudachiPy 不可用：{type(exc).__name__}"

    @property
    def available(self) -> bool:
        return self._tokenizer is not None

    def propose(self, lines: Sequence[Mapping[str, str]], dictionary: Mapping[str, str]) -> Sequence[ReadingProposal]:
        if self._tokenizer is None:
            raise ReadingUnavailable(self.unavailable_reason or "SudachiPy 不可用")
        output: list[ReadingProposal] = []
        for line in lines:
            line_id, text = str(line["id"]), str(line.get("text", ""))
            for token in self._tokenizer.tokenize(text, self._mode):
                start, end = token.begin(), token.end()
                base = text[start:end]
                if not _contains_japanese(base):
                    continue
                reading = dictionary.get(base)
                source = "dictionary" if reading else "sudachi"
                if not reading:
                    reading = token.reading_form()
                if not reading or reading == "*":
                    continue
                reading = _hiragana(reading)
                if _hiragana(base) == reading:
                    continue
                output.append(ReadingProposal(
                    line_id=line_id,
                    proposal_id=_proposal_id(line_id, start, end, base, reading),
                    base_start=start,
                    base_end=end,
                    base=base,
                    reading=reading,
                    source=source,
                    needs_review=source != "dictionary",
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


class ReadingDictionary:
    def __init__(self, db: Database):
        self.db = db

    def list(self, project_id: str) -> list[dict[str, str]]:
        with self.db.connect() as conn:
            rows = conn.execute(
                "SELECT id,surface,reading,updated_at FROM reading_dictionary WHERE project_id=? ORDER BY surface,id",
                (project_id,),
            ).fetchall()
        return [dict(row) for row in rows]

    def create(self, project_id: str, surface: str, reading: str) -> dict[str, str]:
        surface, reading = self._values(surface, reading)
        entry = {"id": uuid.uuid4().hex, "surface": surface, "reading": reading, "updated_at": _now()}
        try:
            with self.db.transaction() as conn:
                conn.execute(
                    "INSERT INTO reading_dictionary(id,project_id,surface,reading,updated_at) VALUES(?,?,?,?,?)",
                    (entry["id"], project_id, surface, reading, entry["updated_at"]),
                )
        except sqlite3.IntegrityError as exc:
            raise DictionaryConflict(surface) from exc
        return entry

    def update(self, project_id: str, entry_id: str, surface: str, reading: str) -> dict[str, str] | None:
        surface, reading = self._values(surface, reading)
        updated_at = _now()
        try:
            with self.db.transaction() as conn:
                cursor = conn.execute(
                    "UPDATE reading_dictionary SET surface=?,reading=?,updated_at=? WHERE id=? AND project_id=?",
                    (surface, reading, updated_at, entry_id, project_id),
                )
                if cursor.rowcount == 0:
                    return None
        except sqlite3.IntegrityError as exc:
            raise DictionaryConflict(surface) from exc
        return {"id": entry_id, "surface": surface, "reading": reading, "updated_at": updated_at}

    def delete(self, project_id: str, entry_id: str) -> bool:
        with self.db.transaction() as conn:
            return conn.execute("DELETE FROM reading_dictionary WHERE id=? AND project_id=?", (entry_id, project_id)).rowcount == 1

    @staticmethod
    def _values(surface: str, reading: str) -> tuple[str, str]:
        surface, reading = surface.strip(), reading.strip()
        if not surface or not reading:
            raise ValueError("surface and reading must be non-empty")
        return surface, reading


class DictionaryConflict(ValueError):
    pass


class DictionaryBody(BaseModel):
    surface: str = Field(min_length=1)
    reading: str = Field(min_length=1)


def build_dictionary_router(store: ReadingDictionary, *, auth, write, project_exists) -> APIRouter:
    router = APIRouter()

    def register(prefix: str) -> None:
        @router.get(prefix)
        def list_entries(pid: str, _: object = Depends(auth)):
            project_exists(pid)
            return {"schema_version": "studio-reading-dictionary-v1", "project_id": pid, "items": store.list(pid)}

        @router.post(prefix, status_code=201)
        def create_entry(pid: str, body: DictionaryBody, _: object = Depends(write)):
            project_exists(pid)
            try:
                entry = store.create(pid, body.surface, body.reading)
            except ValueError as exc:
                raise HTTPException(409 if isinstance(exc, DictionaryConflict) else 422, {"code": "dictionary_conflict" if isinstance(exc, DictionaryConflict) else "dictionary_invalid", "message": str(exc), "retryable": False}) from exc
            return {"schema_version": "studio-reading-dictionary-entry-v1", "project_id": pid, **entry}

        @router.put(prefix + "/{entry_id}")
        def update_entry(pid: str, entry_id: str, body: DictionaryBody, _: object = Depends(write)):
            project_exists(pid)
            try:
                entry = store.update(pid, entry_id, body.surface, body.reading)
            except ValueError as exc:
                raise HTTPException(409 if isinstance(exc, DictionaryConflict) else 422, {"code": "dictionary_conflict" if isinstance(exc, DictionaryConflict) else "dictionary_invalid", "message": str(exc), "retryable": False}) from exc
            if entry is None:
                raise HTTPException(404, {"code": "dictionary_entry_not_found", "message": "dictionary entry not found", "retryable": False})
            return {"schema_version": "studio-reading-dictionary-entry-v1", "project_id": pid, **entry}

        @router.delete(prefix + "/{entry_id}", status_code=204)
        def delete_entry(pid: str, entry_id: str, _: object = Depends(write)):
            project_exists(pid)
            if not store.delete(pid, entry_id):
                raise HTTPException(404, {"code": "dictionary_entry_not_found", "message": "dictionary entry not found", "retryable": False})
            return None

    register("/projects/{pid}/reading-dictionary")
    return router


class ReadingJobRunner:
    """Job adapter that snapshots text from the requested immutable revision."""

    def __init__(self, db: Database, proposer: ReadingProposer):
        self.db, self.proposer, self.dictionary = db, proposer, ReadingDictionary(db)

    def available(self) -> bool:
        return bool(getattr(self.proposer, "available", True))

    def reason(self) -> str | None:
        return getattr(self.proposer, "unavailable_reason", None)

    def run(self, project_id: str, params: Mapping[str, Any]) -> dict[str, Any]:
        if not self.available():
            raise ReadingUnavailable(self.reason() or "未配置日语读音后端")
        revision = params.get("revision")
        with self.db.connect() as conn:
            row = conn.execute(
                "SELECT project_path FROM revisions WHERE id=? AND project_id=?", (revision, project_id)
            ).fetchone()
        if not row:
            raise ValueError("reading revision not found")
        projected = project_ttml(StringIO(read_lyrics(row[0])))
        selected = params.get("line_ids")
        if selected is not None:
            selected_set = set(selected)
            projected = [line for line in projected if line["id"] in selected_set]
        dictionary = {item["surface"]: item["reading"] for item in self.dictionary.list(project_id)}
        proposals = propose_readings(projected, self.proposer, dictionary)
        identity = getattr(self.proposer, "identity", None)
        engine = identity() if callable(identity) else {"name": "reading", "build": "injected"}
        return {"kind": "reading", "engine": engine, "proposals": [item.as_dict() for item in proposals]}

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
