"""Portable server shutdown: consume console signals without replaying them."""
from contextlib import contextmanager
import signal
import threading

import uvicorn


class LocalServer(uvicorn.Server):
    def __init__(self, config, jobs):
        super().__init__(config)
        self.jobs = jobs
        self.stop_worker = None

    @contextmanager
    def capture_signals(self):
        signals = [signal.SIGINT, signal.SIGTERM]
        if hasattr(signal, 'SIGBREAK'):
            signals.append(signal.SIGBREAK)
        original = {sig: signal.signal(sig, self.handle_exit) for sig in signals}
        try:
            yield
        finally:
            # Repeated Ctrl+C must not bypass task cancellation and lifespan cleanup.
            if self.stop_worker:
                self.stop_worker.join()
            for sig, handler in original.items():
                signal.signal(sig, handler)

    def handle_exit(self, sig, frame):
        if self.should_exit:
            return
        self.should_exit = True
        print('正在停止 Studio，请稍候…', flush=True)

        def stop():
            from .process_supervisor import seal
            seal()
            self.jobs.close()

        # Keep blocking database/process cleanup out of the signal handler.
        self.stop_worker = threading.Thread(target=stop, name='studio-stop')
        self.stop_worker.start()
