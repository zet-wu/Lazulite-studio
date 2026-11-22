"""S4 rich document HTTP boundary.

The router is deliberately dependency-injected so app.py remains the owner of
authentication and project lookup policy.
"""
from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from typing import Callable

from fastapi import APIRouter, Depends, Header, HTTPException, Response
from pydantic import BaseModel, ConfigDict, Field

from .document_errors import DocumentInvalid
from .revisions import IdempotencyConflict, RevisionConflict, RevisionStore
from .time_units import try_parse_media_seconds

TTML_NS = "http://www.w3.org/ns/ttml"
_DOCTYPE = re.compile(r"<!\s*(?:DOCTYPE|ENTITY)\b", re.I)


from .project_document import ProjectSnapshot


class DocumentEnvelope(BaseModel):
    model_config = ConfigDict(extra="forbid")
    schema_version: str = Field(min_length=1, max_length=80)
    project_id: str = Field(min_length=1, max_length=200)
    revision: str | None = None
    document: ProjectSnapshot
    source_asset_id: str | None = None
    client_seq: int | None = Field(default=None, ge=0)


def validate_ttml(ttml: str) -> ET.Element:
    raw = ttml.encode("utf-8")
    if _DOCTYPE.search(ttml):
        raise ValueError("DTD and external entities are not accepted")
    try:
        root = ET.fromstring(raw)
    except (ET.ParseError, ValueError, UnicodeError) as exc:
        raise ValueError("invalid XML") from exc
    if root.tag != f"{{{TTML_NS}}}tt":
        raise ValueError("root must be TTML tt element")
    # Pass 1: depth check, xml:id uniqueness, timing ordering, content-flag placement,
    # and collecting agent definitions & references.
    ids: set[str] = set()
    agents: set[str | None] = set()
    agent_refs: list[tuple[ET.Element, str]] = []
    actor_elements: list[ET.Element] = []
    amll_obscene = "{http://www.example.com/ns/amll}obscene"
    ruby = "{http://www.w3.org/ns/ttml#styling}ruby"
    role = "{http://www.w3.org/ns/ttml#metadata}role"
    ttm_agent = "{http://www.w3.org/ns/ttml#metadata}agent"
    ttm_actor = "{http://www.w3.org/ns/ttml#metadata}actor"
    xml_id_attr = "{http://www.w3.org/XML/1998/namespace}id"
    ttml_prefix = f"{{{TTML_NS}}}"
    word_span_tag = f"{ttml_prefix}span"
    line_p_tag = f"{ttml_prefix}p"

    def walk(element: ET.Element, parent: ET.Element | None, grandparent: ET.Element | None, depth: int) -> None:
        if depth > 128:
            raise ValueError("TTML nesting exceeds depth 128")
        xml_id = element.attrib.get(xml_id_attr)
        if xml_id:
            if xml_id in ids:
                raise ValueError("duplicate xml:id")
            ids.add(xml_id)
        if element.tag.startswith(ttml_prefix):
            b = try_parse_media_seconds(element.attrib.get("begin"))
            e = try_parse_media_seconds(element.attrib.get("end"))
            if b is not None and e is not None and e < b:
                raise ValueError("end timing precedes begin")
        roles = element.get(role, "").split()
        expletive = "expletive" in roles
        if amll_obscene in element.attrib or expletive:
            if expletive and element.get(amll_obscene) == "false":
                raise ValueError("expletive conflicts with amll:obscene=false")
            background = (
                parent is not None
                and parent.tag == word_span_tag
                and parent.get(role) == "x-bg"
                and grandparent is not None
                and grandparent.tag == line_p_tag
            )
            if (
                element.get(amll_obscene) not in (None, "true", "false")
                or element.tag != word_span_tag
                or element.get(ruby) not in (None, "container")
                or any(value != "expletive" for value in roles)
                or parent is None
                or not (parent.tag == line_p_tag or background)
            ):
                raise ValueError("amll:obscene requires a word and a true/false value")
        if element.tag == ttm_agent:
            agents.add(xml_id)
        ref = element.attrib.get(ttm_agent, "")
        if ref:
            agent_refs.append((element, ref))
        if element.tag == ttm_actor:
            actor_elements.append(element)
        for child in element:
            walk(child, element, parent, depth + 1)

    walk(root, None, None, 1)
    # Pass 2: validate agent and actor references against collected agent definitions.
    for element, ref in agent_refs:
        if element.get(ruby) in ("base", "text", "textContainer"):
            raise ValueError("Ruby 不支持独立歌手")
        if any(item not in agents for item in ref.split()):
            raise ValueError("unknown ttm:agent reference")
    for element in actor_elements:
        if element.attrib.get("agent") not in agents:
            raise ValueError("unknown actor agent reference")
    return root


class DocumentService:
    def __init__(self, revisions: RevisionStore):
        self.revisions = revisions

    def get(self, project_id: str, revision: str | None = None) -> dict:
        rev, snapshot, source_asset_id = self.revisions.read_bound(project_id, revision)
        return {
            "schema_version": "studio-document-v9",
            "project_id": project_id,
            "revision": rev,
            "etag": f'"{rev}"',
            "document": snapshot,
            "source_asset_id": source_asset_id,
        }

    def save(self, body: DocumentEnvelope, *, if_match: str | None,
             operation_id: str | None, subject: str = "local") -> dict:
        if body.schema_version != "studio-document-v9":
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
            result = self.revisions.create(body.project_id, body.document, base,
                operation_id=operation_id, subject=subject, client_seq=body.client_seq)
        except KeyError as exc:
            raise HTTPException(404, {"code": "project_not_found", "message": "project or revision not found", "retryable": False}) from exc
        except DocumentInvalid as exc:
            raise HTTPException(422, {"code": "document_invalid", "reason": exc.reason, "params": exc.params, "message": str(exc), "retryable": False}) from exc
        except ValueError as exc:
            raise HTTPException(422, {"code": "document_invalid", "reason": "invalid_snapshot", "message": str(exc), "retryable": False}) from exc
        except RevisionConflict as exc:
            raise HTTPException(412, {"code": "revision_conflict", "message": "document revision is stale", "retryable": False, "current_revision": exc.current}) from exc
        except IdempotencyConflict as exc:
            raise HTTPException(409, {"code": "idempotency_mismatch", "message": "operation id was used for another request", "retryable": False}) from exc
        return {"revision": result["id"], "etag": result["etag"]}


def build_router(service: DocumentService, *, auth: Callable, write: Callable,
                 project_exists: Callable[[str], object]) -> APIRouter:
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
    def put_document(pid: str, body: DocumentEnvelope,
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

    return router
