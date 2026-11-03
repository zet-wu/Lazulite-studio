from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    password: str | None = None
    trusted_gateway: bool = False
    mode: str = 'password'

    def __post_init__(self):
        if self.mode not in {'password', 'local'}:
            raise ValueError('未知运行模式')
        if self.mode == 'local':
            if self.trusted_gateway or self.password:
                raise ValueError('本机模式不接受密码或代理认证')

    @classmethod
    def from_env(cls):
        return cls(
            os.getenv("STUDIO_PASSWORD"),
            os.getenv("STUDIO_TRUSTED_GATEWAY", "false").lower() == "true",
        )
