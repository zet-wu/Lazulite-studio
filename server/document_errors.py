"""Structured document rejection diagnostics, independent of display language."""


class DocumentInvalid(ValueError):
    def __init__(self, reason: str, message: str, **params):
        super().__init__(message)
        self.reason = reason
        self.params = params
