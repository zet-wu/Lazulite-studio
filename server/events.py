"""In-process per-project SSE event hub for revision and job updates."""
from __future__ import annotations

import asyncio
import threading
from typing import AsyncIterator


class ProjectEventHub:
    """Thread-safe pub/sub delivering lightweight project events to SSE subscribers."""

    def __init__(self, max_queue_size: int = 128) -> None:
        self._max_queue_size = max_queue_size
        self._lock = threading.Lock()
        self._subscribers: dict[str, set[tuple[asyncio.AbstractEventLoop, asyncio.Queue[dict | None]]]] = {}
        self._closed = False

    def publish(self, project_id: str, event_type: str, **payload: object) -> None:
        event = {"type": event_type, "project_id": project_id, **payload}
        with self._lock:
            if self._closed:
                return
            targets = list(self._subscribers.get(project_id, ()))
        for loop, queue in targets:
            if loop.is_closed():
                continue
            try:
                loop.call_soon_threadsafe(self._enqueue, queue, event)
            except RuntimeError:
                pass

    def _enqueue(self, queue: asyncio.Queue[dict | None], item: dict | None) -> None:
        if item is None:
            while queue.full():
                try:
                    queue.get_nowait()
                except asyncio.QueueEmpty:
                    break
            try:
                queue.put_nowait(None)
            except asyncio.QueueFull:
                pass
            return
        if queue.full():
            try:
                queue.get_nowait()
            except asyncio.QueueEmpty:
                pass
        try:
            queue.put_nowait(item)
        except asyncio.QueueFull:
            pass

    async def subscribe(self, project_id: str) -> AsyncIterator[dict]:
        loop = asyncio.get_running_loop()
        queue: asyncio.Queue[dict | None] = asyncio.Queue(maxsize=self._max_queue_size)
        entry = (loop, queue)
        with self._lock:
            if self._closed:
                return
            self._subscribers.setdefault(project_id, set()).add(entry)
        try:
            while True:
                item = await queue.get()
                if item is None:
                    break
                yield item
        finally:
            with self._lock:
                group = self._subscribers.get(project_id)
                if group is not None:
                    group.discard(entry)
                    if not group:
                        self._subscribers.pop(project_id, None)

    def close(self) -> None:
        with self._lock:
            if self._closed:
                return
            self._closed = True
            all_targets = [entry for group in self._subscribers.values() for entry in group]
            self._subscribers.clear()
        for loop, queue in all_targets:
            if loop.is_closed():
                continue
            try:
                loop.call_soon_threadsafe(self._enqueue, queue, None)
            except RuntimeError:
                pass
