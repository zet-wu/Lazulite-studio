import asyncio
import threading
import zipfile
from typing import Any, Literal

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from .dictionaries import DictionaryConflict
from .dictionary_engine import AnalysisCancelled
from .reading import ReadingSnapshot


class DictionaryInfo(BaseModel):
    id: str
    instance: str
    manifest: dict[str, Any] | None
    sources: dict[str, Any] | list[Any] | None
    error: str | None


class DictionaryList(BaseModel):
    dictionaries: list[DictionaryInfo]
    errors: list[str]


class DictionaryInstall(BaseModel):
    manifest: dict[str, Any]
    sources: dict[str, Any] | list[Any]
    entryCount: int
    instance: str | None = None
    replaceRequired: bool = False


class DictionarySnapshot(ReadingSnapshot):
    instance: str = Field(min_length=1, max_length=100)


class DictionaryRange(BaseModel):
    line_id: str
    base_start: int
    base_end: int
    base: str
    status: Literal["known", "unknown", "ambiguous", "boundary", "unannotated"]
    units: list[str]


class DictionaryAnalysis(BaseModel):
    instance: str
    version: str
    ranges: list[DictionaryRange]


def error(exc):
    status = 409 if isinstance(exc, DictionaryConflict) else 404 if isinstance(exc, KeyError) else 422
    message = "词典已移除，请重新选择" if isinstance(exc, KeyError) else f"词典操作失败：{exc}"
    return HTTPException(status, {"code": "dictionary_error", "message": message, "retryable": False})


def dictionary_router(manager, *, auth, write):
    router = APIRouter(prefix="/reading/dictionaries")

    @router.get("", response_model=DictionaryList)
    def listing(_: object = Depends(auth)):
        return manager.list()

    @router.post("/import", response_model=DictionaryInstall)
    def install(file: UploadFile = File(...), replace: bool = Query(False), inspect: bool = Query(False), _: object = Depends(write)):
        try:
            return manager.install(file.file, replace=replace, inspect=inspect)
        except (ValueError, OSError, zipfile.BadZipFile) as exc:
            raise error(exc) from exc
        finally:
            file.file.close()

    @router.delete("/{ident}", status_code=204)
    def remove(ident: str, _: object = Depends(write)):
        try:
            manager.remove(ident)
        except (ValueError, KeyError, OSError) as exc:
            raise error(exc) from exc

    @router.post("/{ident}/analyze", response_model=DictionaryAnalysis)
    async def analyze(ident: str, body: DictionarySnapshot, request: Request, _: object = Depends(write)):
        cancelled = threading.Event()
        def run():
            with manager.acquire(ident, body.instance, cancelled) as index:
                return {"instance": body.instance, "version": index.manifest["version"],
                        "ranges": index.snapshot([line.model_dump() for line in body.lines], cancelled)}
        task = asyncio.create_task(run_in_threadpool(run))
        try:
            while not task.done():
                await asyncio.wait({task}, timeout=0.1)
                if await request.is_disconnected():
                    cancelled.set()
            return await task
        except AnalysisCancelled as exc:
            raise HTTPException(499, "词典分析已取消") from exc
        except (ValueError, KeyError, OSError) as exc:
            raise error(exc) from exc
        finally:
            cancelled.set()
            if not task.done():
                # The worker releases its instance before this request is discarded.
                try:
                    await task
                except AnalysisCancelled:
                    pass

    return router
