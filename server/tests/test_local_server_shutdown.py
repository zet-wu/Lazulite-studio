import signal
import threading
from types import SimpleNamespace

import pytest
import uvicorn

from server.local_server import LocalServer


@pytest.mark.parametrize('sig', [signal.SIGINT, signal.SIGTERM])
def test_console_stop_is_idempotent_waits_for_cleanup_and_does_not_replay(monkeypatch, sig):
    monkeypatch.setattr('server.process_supervisor.seal', lambda: None)
    started, finish = threading.Event(), threading.Event()
    calls = []
    def close():
        calls.append('close')
        started.set()
        assert finish.wait(2)
    server = LocalServer(uvicorn.Config(lambda: None), SimpleNamespace(close=close))
    previous = signal.getsignal(sig)
    with server.capture_signals():
        signal.raise_signal(sig)
        assert started.wait(2)
        signal.raise_signal(sig)
        assert server.should_exit and not server.force_exit
        finish.set()
    assert calls == ['close']
    assert not server.stop_worker.is_alive()
    assert signal.getsignal(sig) == previous
