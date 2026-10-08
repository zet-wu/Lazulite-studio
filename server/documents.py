"""S4 rich document HTTP boundary.

The router is deliberately dependency-injected so app.py remains the owner of
authentication and project lookup policy.
"""
from __future__ import annotations

import hashlib
import re
import xml.etree.ElementTree as ET
from typing import Callable

from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field

from .revisions import IdempotencyConflict, RevisionConflict, RevisionStore

TTML_NS = "http://www.w3.org/ns/ttml"
MAX_TTML_BYTES = 2 * 1024 * 1024
_DOCTYPE = re.compile(r"<!\s*(?:DOCTYPE|ENTITY)\b", re.I)
_TIME = re.compile(r"^(?:\d+(?:\.\d+)?(?:ms|s)?|\d+:\d{2}(?::\d{2})?(?:\.\d+)?)$")
_LRC = re.compile(r"\[(\d{1,3}):(\d{2})(?:\.(\d{1,3}))?\](.*)$")
_LRC_TAGS = re.compile(r"\[(\d{1,3}):(\d{2})(?:\.(\d{1,3}))?\]")


from .project_document import ProjectSnapshot


class DocumentEnvelope(BaseModel):
    model_config = ConfigDict(extra="forbid")
    schema_version: str = Field(min_length=1, max_length=80)
    project_id: str = Field(min_length=1, max_length=200)
    revision: str | None = None
    document: ProjectSnapshot
    client_seq: int | None = Field(default=None, ge=0)


def validate_ttml(ttml: str) -> str:
    raw = ttml.encode("utf-8")
    if len(raw) > MAX_TTML_BYTES:
        raise ValueError("TTML exceeds 2 MiB limit")
    if _DOCTYPE.search(ttml):
        raise ValueError("DTD and external entities are not accepted")
    try:
        root = ET.fromstring(raw)
    except (ET.ParseError, ValueError, UnicodeError) as exc:
        raise ValueError("invalid XML") from exc
    if root.tag != f"{{{TTML_NS}}}tt":
        raise ValueError("root must be TTML tt element")
    # Reject parser-resolved entity references and pathological nesting while
    # retaining all valid unknown elements, attributes, and namespaces.
    def walk(element: ET.Element, depth: int) -> None:
        if depth > 128:
            raise ValueError("TTML nesting exceeds depth 128")
        for child in list(element):
            walk(child, depth + 1)
    walk(root, 1)
    ids: set[str] = set()
    for element in root.iter():
        xml_id = element.attrib.get("{http://www.w3.org/XML/1998/namespace}id")
        if xml_id:
            if xml_id in ids:
                raise ValueError("duplicate xml:id")
            ids.add(xml_id)
        begin, end = element.attrib.get("begin"), element.attrib.get("end")
        # Known media-time forms get basic ordering validation. Other TTML
        # expressions (frame/tick/WallClock) remain intact and read-only for
        # the browser codec.
        def seconds(value: str | None) -> float | None:
            if value is None or not _TIME.match(value.strip()):
                return None
            value = value.strip()
            if value.endswith("ms"):
                return float(value[:-2]) / 1000
            if value.endswith("s"):
                return float(value[:-1])
            if ":" not in value:
                return float(value)
            parts = value.split(":")
            h, m, rest = parts if len(parts) == 3 else ["0", *parts]
            return int(h) * 3600 + int(m) * 60 + float(rest)
        if element.tag == f"{{{TTML_NS}}}tt" or element.tag.startswith(f"{{{TTML_NS}}}"):
            b, e = seconds(begin), seconds(end)
            if b is not None and e is not None and e < b:
                raise ValueError("end timing precedes begin")
    # The AMLL content flag belongs only to a body word (including a Ruby
    # container or background word), never an individual reading or line.
    parents = {child: parent for parent in root.iter() for child in parent}
    amll_obscene = "{http://www.example.com/ns/amll}obscene"
    ruby = "{http://www.w3.org/ns/ttml#styling}ruby"
    role = "{http://www.w3.org/ns/ttml#metadata}role"
    for element in root.iter():
        roles = element.get(role, '').split()
        expletive = 'expletive' in roles
        if amll_obscene not in element.attrib and not expletive:
            continue
        if expletive and element.get(amll_obscene) == 'false':
            raise ValueError('expletive conflicts with amll:obscene=false')
        parent = parents.get(element)
        background = parent is not None and parent.tag == f"{{{TTML_NS}}}span" and parent.get(role) == 'x-bg' and parents.get(parent) is not None and parents[parent].tag == f"{{{TTML_NS}}}p"
        if (element.get(amll_obscene) not in (None, 'true', 'false') or element.tag != f"{{{TTML_NS}}}span"
                or element.get(ruby) not in (None, 'container') or any(value != 'expletive' for value in roles)
                or parent is None or not (parent.tag == f"{{{TTML_NS}}}p" or background)):
            raise ValueError('amll:obscene requires a word and a true/false value')
    agents = {
        e.attrib.get("{http://www.w3.org/XML/1998/namespace}id")
        for e in root.iter()
        if e.tag == "{http://www.w3.org/ns/ttml#metadata}agent"
    }
    for element in root.iter():
        ref = element.attrib.get("{http://www.w3.org/ns/ttml#metadata}agent", "")
        if ref and element.get(ruby) in ('base','text','textContainer'): raise ValueError('Ruby 不支持独立歌手')
        if any(item not in agents for item in ref.split()):
            raise ValueError("unknown ttm:agent reference")
    for element in root.iter("{http://www.w3.org/ns/ttml#metadata}actor"):
        if element.attrib.get("agent") not in agents:
            raise ValueError("unknown actor agent reference")
    return ttml


class DocumentService:
    def __init__(self, revisions: RevisionStore):
        self.revisions = revisions

    def get(self, project_id: str, revision: str | None = None) -> dict:
        rev, snapshot = self.revisions.read(project_id, revision)
        import json
        digest = hashlib.sha256(json.dumps(snapshot, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
        return {
            "schema_version": "studio-document-v7",
            "project_id": project_id,
            "revision": rev,
            "etag": f'"{rev}"',
            "document": snapshot,
            "sha256": digest,
        }

    def resolve_revision(self, project_id: str, revision: str | None) -> str:
        resolved, _ = self.revisions.read(project_id, revision)
        return resolved

    def save(self, body: DocumentEnvelope, *, if_match: str | None,
             operation_id: str | None, subject: str = "local") -> dict:
        if body.schema_version != "studio-document-v7":
            raise HTTPException(422, {"code": "document_schema_unsupported", "message": "unsupported document schema version", "retryable": False})
        if not body.project_id:
            raise ValueError("project_id is required")
        if not if_match:
            raise HTTPException(428, {"code": "precondition_required", "message": "If-Match is required", "retryable": False})
        base = if_match.strip()
        if base.startswith("W/"):
            raise HTTPException(412, {"code": "revision_conflict", "message": "weak ETag is not accepted", "retryable": False})
        base = base.strip('"')
        if body.revision is not None and body.revision != base:
            raise HTTPException(412, {"code": "revision_conflict", "message": "body revision does not match If-Match", "retryable": False})
        try:
            result = self.revisions.create(body.project_id, body.document.model_dump(), base,
                operation_id=operation_id, subject=subject, client_seq=body.client_seq)
        except KeyError as exc:
            raise HTTPException(404, {"code": "project_not_found", "message": "project or revision not found", "retryable": False}) from exc
        except ValueError as exc:
            raise HTTPException(422, {"code": "document_invalid", "message": str(exc), "retryable": False}) from exc
        except RevisionConflict as exc:
            raise HTTPException(412, {"code": "revision_conflict", "message": "document revision is stale", "retryable": False, "current_revision": exc.current}) from exc
        except IdempotencyConflict as exc:
            raise HTTPException(409, {"code": "idempotency_mismatch", "message": "operation id was used for another request", "retryable": False}) from exc
        return {**self.get(body.project_id, result["id"]), "saved": result}


def build_router(service: DocumentService, *, auth: Callable, write: Callable,
                 project_exists: Callable[[str], object], fail: Callable | None = None) -> APIRouter:
    router = APIRouter()

    @router.get("/projects/{pid}/document")
    def get_document(pid: str, response: Response, _: object = Depends(auth)):
        try:
            project_exists(pid)
            out = service.get(pid)
        except KeyError as exc:
            raise HTTPException(404, {"code": "revision_not_found", "message": "document revision not found", "retryable": False}) from exc
        response.headers["ETag"] = out["etag"]
        out.pop("etag", None)
        return out

    @router.put("/projects/{pid}/document")
    def put_document(pid: str, body: DocumentEnvelope, request: Request,
                     response: Response, subject: str = Depends(write),
                     if_match: str | None = Header(default=None, alias="If-Match"),
                     operation_id: str | None = Header(default=None, alias="Idempotency-Key")):
        if body.project_id != pid:
            raise HTTPException(422, {"code": "project_mismatch", "message": "project_id does not match path", "retryable": False})
        project_exists(pid)
        # client_seq is a client-visible ordering number; Idempotency-Key is
        # the transport idempotency identifier.
        out = service.save(body, if_match=if_match, operation_id=operation_id, subject=subject)
        response.headers["ETag"] = out["etag"]
        out.pop("etag", None)
        return out

    @router.post("/projects/{pid}/imports")
    async def import_candidate(pid: str, request: Request, revision: str | None = None, _: object = Depends(write)):
        """Parse an import as a candidate; never changes the current revision."""
        project_exists(pid)
        try:
            input_revision = service.resolve_revision(pid, revision)
        except KeyError as exc:
            raise HTTPException(404, {"code": "revision_not_found", "message": "revision not found", "retryable": False}) from exc
        content_type = request.headers.get("content-type", "").split(";", 1)[0].lower()
        data = await request.body()
        if len(data) > MAX_TTML_BYTES:
            raise HTTPException(413, {"code": "import_too_large", "message": "import exceeds 2 MiB limit", "retryable": False})
        try:
            text = data.decode("utf-8-sig")
            if content_type in ("application/ttml+xml", "application/xml", "text/xml"):
                validate_ttml(text)
                diagnostics = []
                candidate = {"format": "ttml", "ttml": text}
            elif content_type in ("text/plain", "text/lrc", "application/lrc"):
                fmt = "text" if content_type == "text/plain" else "lrc"
                lines = []
                if fmt == "text":
                    lines = [{"begin_ms": None, "end_ms": None, "text": raw_line} for raw_line in text.splitlines() if raw_line.strip()]
                else:
                    offsets = []
                    for raw_line in text.splitlines():
                        if raw_line.lower().startswith("[offset:"):
                            try:
                                offsets.append(int(raw_line[8:].split("]", 1)[0]))
                            except ValueError:
                                pass
                    offset_ms = offsets[-1] if offsets else 0
                    timed = []
                    for raw_line in text.splitlines():
                        if raw_line.lower().startswith("[offset:"):
                            continue
                        if re.match(r"^\[[A-Za-z]+:", raw_line):
                            continue
                        tags = list(_LRC_TAGS.finditer(raw_line))
                        body = _LRC_TAGS.sub("", raw_line).strip()
                        if not body:
                            continue
                        for tag in tags:
                            fraction = (tag.group(3) or "").ljust(3, "0")
                            begin = max(0, ((int(tag.group(1)) * 60 + int(tag.group(2))) * 1000 + int(fraction)) + offset_ms)
                            timed.append((begin, body))
                    timed.sort(key=lambda item: item[0])
                    for index, (begin, body) in enumerate(timed):
                        end = timed[index + 1][0] if index + 1 < len(timed) else None
                        lines.append({"begin_ms": begin, "end_ms": end, "text": body})
                candidate = {"format": fmt, "text": text, "lines": lines}
                diagnostics = [{"code": "candidate_only", "message": "import is a candidate and was not saved"}]
            else:
                raise ValueError("unsupported import format")
        except (UnicodeError, ValueError) as exc:
            raise HTTPException(422, {"code": "import_invalid", "message": str(exc), "retryable": False}) from exc
        return {"schema_version": "studio-import-v1", "project_id": pid, "input_revision": input_revision, "candidate": candidate, "diagnostics": diagnostics, "saved": False}

    return router
