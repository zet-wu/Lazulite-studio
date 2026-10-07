from __future__ import annotations

import uuid

from starlette.exceptions import HTTPException
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send


class UploadLimitMiddleware:
    def __init__(self, app: ASGIApp, limit: int):
        self.app = app
        self.limit = limit

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or not scope["path"].endswith("/uploads"):
            await self.app(scope, receive, send)
            return
        content_length = next(
            (
                value
                for key, value in scope.get("headers", [])
                if key == b"content-length"
            ),
            None,
        )
        if content_length:
            try:
                too_large = int(content_length) > self.limit
            except ValueError:
                await self._bad_length(scope, send)
                return
            if too_large:
                await self._too_large(scope, send)
                return
        total = 0

        async def limited_receive() -> Message:
            nonlocal total
            message = await receive()
            if message["type"] == "http.request":
                total += len(message.get("body", b""))
                if total > self.limit:
                    raise HTTPException(
                        status_code=413,
                        detail={
                            "code": "upload_too_large",
                            "message": "upload exceeds limit",
                            "retryable": False,
                        },
                    )
            return message

        try:
            await self.app(scope, limited_receive, send)
        except HTTPException as error:
            if error.status_code != 413:
                raise
            await self._too_large(scope, send)

    async def _too_large(self, scope: Scope, send: Send) -> None:
        response = JSONResponse(
            {
                "code": "upload_too_large",
                "message": "upload exceeds limit",
                "retryable": False,
                "request_id": next(
                    (
                        value.decode()
                        for key, value in scope.get("headers", [])
                        if key == b"x-request-id"
                    ),
                    uuid.uuid4().hex,
                ),
            },
            status_code=413,
        )
        await response(scope, _empty_receive, send)

    async def _bad_length(self, scope: Scope, send: Send) -> None:
        response = JSONResponse(
            {
                "code": "http_error",
                "message": "invalid content length",
                "retryable": False,
                "request_id": uuid.uuid4().hex,
            },
            status_code=400,
        )
        await response(scope, _empty_receive, send)


async def _empty_receive() -> Message:
    return {"type": "http.disconnect"}
