from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    password: str | None = None
    trusted_gateway: bool = False
    origin: str | None = None

    def __post_init__(self):
        if self.origin is not None:
            object.__setattr__(self, "origin", normalize_origin(self.origin))

    @classmethod
    def from_env(cls):
        return cls(
            os.getenv("STUDIO_PASSWORD"),
            os.getenv("STUDIO_TRUSTED_GATEWAY", "false").lower() == "true",
            os.getenv("STUDIO_ORIGIN"),
        )


def normalize_origin(value: str) -> str:
    """One browser HTTP(S) origin, independent of the server listening port."""
    from urllib.parse import urlsplit
    import ipaddress
    import re
    if not value or any(c.isspace() or ord(c) < 32 for c in value) or any(c in value for c in '\\?#'):
        raise ValueError('浏览器来源必须是单一 HTTP(S) 地址，不含路径、查询或片段')
    try:
        url = urlsplit(value)
        host, port = url.hostname, url.port
    except ValueError as error:
        raise ValueError('浏览器来源的主机或端口无效') from error
    if url.scheme not in {'http', 'https'} or not host or url.username is not None or url.password is not None or url.path or url.netloc.endswith(':'):
        raise ValueError('浏览器来源必须是单一 HTTP(S) 地址，不含用户信息或路径')
    if port is not None and not 1 <= port <= 65535:
        raise ValueError('浏览器来源端口必须位于 1–65535')
    if '%' in host:
        raise ValueError('浏览器来源不接受编码主机或 IPv6 区域标识')
    if ':' in host:
        host = '[' + ipaddress.IPv6Address(host).compressed + ']'
    else:
        host = host.encode('idna').decode('ascii').lower()
        if not all(re.fullmatch(r'[a-z0-9](?:[a-z0-9-]*[a-z0-9])?', label) for label in host.rstrip('.').split('.')):
            raise ValueError('浏览器来源主机无效')
        if all(c.isdigit() or c == '.' for c in host):
            host = str(ipaddress.IPv4Address(host))
    suffix = '' if port is None or port == {'http':80,'https':443}[url.scheme] else f':{port}'
    return f'{url.scheme}://{host}{suffix}'
