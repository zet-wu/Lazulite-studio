"""Managed local Node 22 MCP subprocess lifecycle and loopback HTTP reverse proxy."""
from __future__ import annotations

from dataclasses import dataclass
import os
from pathlib import Path
import socket
import subprocess
import time
from typing import Iterable
import urllib.request

from fastapi import HTTPException, Request
from fastapi.responses import StreamingResponse
import httpx
from starlette.background import BackgroundTask

from . import process_supervisor

_LOOPBACK_HOSTS = {"127.0.0.1", "localhost", "::1", "[::1]"}
_HOP_BY_HOP_HEADERS = {
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailers",
    "transfer-encoding",
    "upgrade",
    "content-length",
    "host",
}


@dataclass
class McpHandle:
    process: subprocess.Popen
    port: int

    def stop(self) -> None:
        process_supervisor.stop(self.process)


def bundled_node_path(root: Path) -> Path:
    binary = "node.exe" if os.name == "nt" else "node"
    return Path(root) / "runtime" / "node" / binary


def find_mcp_runtime(root: Path) -> tuple[Path, Path] | None:
    root_path = Path(root)
    node_bin = bundled_node_path(root_path)
    script_path = root_path / "app" / "mcp" / "server.mjs"
    if node_bin.is_file() and script_path.is_file():
        return node_bin, script_path
    return None


def pick_loopback_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def _wait_for_health(process: subprocess.Popen, port: int, timeout_s: float = 10.0) -> None:
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    health_url = f"http://127.0.0.1:{port}/health"
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f"内置 MCP 服务提前退出（exit={process.returncode}）")
        try:
            with opener.open(health_url, timeout=0.5) as response:
                if response.status == 200:
                    return
        except OSError:
            pass
        time.sleep(0.05)
    process_supervisor.stop(process)
    raise RuntimeError("内置 MCP 服务健康检查超时")


def start_mcp_process(
    node_bin: Path,
    script_path: Path,
    *,
    studio_origin: str,
    identity_file: Path,
    mcp_port: int | None = None,
    timeout_s: float = 10.0,
) -> McpHandle:
    port = mcp_port or pick_loopback_port()
    args = [
        str(node_bin),
        str(script_path),
        "--transport",
        "http",
        "--host",
        "127.0.0.1",
        "--port",
        str(port),
        "--studio-url",
        studio_origin,
        "--identity-file",
        str(identity_file),
    ]
    process = process_supervisor.spawn(args, stdin=subprocess.DEVNULL)
    _wait_for_health(process, port, timeout_s=timeout_s)
    return McpHandle(process=process, port=port)


def _is_loopback_host_header(host_value: str) -> bool:
    if not host_value:
        return True
    host = host_value.strip().lower()
    if host.startswith("["):
        end = host.find("]")
        hostname = host[: end + 1] if end != -1 else host
    else:
        hostname = host.split(":", 1)[0]
    return hostname in _LOOPBACK_HOSTS


def _filter_headers(headers: Iterable[tuple[str, str]]) -> list[tuple[str, str]]:
    return [(k, v) for k, v in headers if k.lower() not in _HOP_BY_HOP_HEADERS]


def mount_mcp_proxy(app, target_origin: str) -> None:
    """Expose Streamable HTTP MCP at /mcp on the Studio loopback origin."""
    target_url = target_origin.rstrip("/") + "/mcp"

    @app.api_route("/mcp", methods=["GET", "POST", "DELETE"], include_in_schema=False)
    async def proxy_mcp(request: Request):
        if not _is_loopback_host_header(request.headers.get("host", "")):
            raise HTTPException(403, {"code": "forbidden_host", "message": "MCP endpoint is loopback-only", "retryable": False})
        origin = request.headers.get("origin")
        if origin:
            from urllib.parse import urlparse

            parsed = urlparse(origin)
            if (parsed.hostname or "").lower() not in {"127.0.0.1", "localhost", "::1"}:
                raise HTTPException(403, {"code": "forbidden_origin", "message": "Cross-origin MCP access denied", "retryable": False})

        body = await request.body()
        forward_headers = _filter_headers(request.headers.items())
        client = httpx.AsyncClient(trust_env=False, timeout=None)
        req = client.build_request(
            request.method,
            target_url,
            headers=forward_headers,
            content=body,
            params=request.query_params,
        )
        try:
            upstream = await client.send(req, stream=True)
        except httpx.HTTPError as exc:
            await client.aclose()
            raise HTTPException(502, {"code": "mcp_unavailable", "message": f"MCP 服务不可用：{exc}", "retryable": True}) from exc

        response_headers = {k: v for k, v in _filter_headers(upstream.headers.items())}

        async def close_upstream() -> None:
            await upstream.aclose()
            await client.aclose()

        return StreamingResponse(
            upstream.aiter_raw(),
            status_code=upstream.status_code,
            headers=response_headers,
            background=BackgroundTask(close_upstream),
        )
