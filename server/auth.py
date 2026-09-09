from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    password: str | None = None
    trusted_gateway: bool = False
    origin: str | None = None

    @classmethod
    def from_env(cls):
        return cls(
            os.getenv("STUDIO_PASSWORD"),
            os.getenv("STUDIO_TRUSTED_GATEWAY", "false").lower() == "true",
            os.getenv("STUDIO_ORIGIN"),
        )
