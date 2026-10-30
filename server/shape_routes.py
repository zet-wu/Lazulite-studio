import asyncio
import threading
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, model_validator
from starlette.concurrency import run_in_threadpool
from .shape_conversion import analyze_shapes, ShapeCancelled


class ShapeLine(BaseModel):
    model_config = ConfigDict(extra='forbid')
    id: str = Field(min_length=1,max_length=200)
    text: str = Field(max_length=100000)


class ShapeRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    target: Literal['simplified','taiwan','hongkong','japanese']
    lines: list[ShapeLine] = Field(min_length=1,max_length=10000)

    @model_validator(mode='after')
    def valid_lines(self):
        if len({line.id for line in self.lines})!=len(self.lines): raise ValueError('行 ID 重复')
        if sum(len(line.text) for line in self.lines)>1000000: raise ValueError('正文过长')
        return self


class ShapeCell(BaseModel):
    start: int
    end: int
    original: str
    value: str
    status: Literal['known','ambiguous','failed']


class ShapeRow(BaseModel):
    id: str
    cells: list[ShapeCell]


class ShapeResponse(BaseModel):
    rows: list[ShapeRow]


def shape_router(*,write):
    router=APIRouter()
    semaphore=asyncio.Semaphore(2)

    @router.post('/shapes/analyze',response_model=ShapeResponse)
    async def analyze(body:ShapeRequest,request:Request,_:object=Depends(write)):
        cancelled=threading.Event()
        async def work():
            async with semaphore:
                return await run_in_threadpool(analyze_shapes,[line.model_dump() for line in body.lines],body.target,cancelled)
        task=asyncio.create_task(work())
        try:
            while not task.done():
                if await request.is_disconnected():
                    cancelled.set()
                await asyncio.wait({task},timeout=.1)
            return await task
        except ShapeCancelled:
            raise HTTPException(499,{'code':'cancelled','message':'转换已取消','retryable':True})
        except (ValueError,OSError,ImportError,KeyError) as exc:
            raise HTTPException(422,{'code':'shape_failed','message':f'字形分析失败：{exc}','retryable':True}) from exc
        finally:
            cancelled.set()
            if not task.done():
                try: await asyncio.shield(task)
                except (ShapeCancelled,asyncio.CancelledError): pass
    return router
