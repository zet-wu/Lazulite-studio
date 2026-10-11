"""One supervised model process per vocal job, outside the API's Python GIL."""
from __future__ import annotations
import json
import logging
import subprocess
import sys
import threading
from pathlib import Path

from .engine import EngineUnavailable
from .runtime_devices import DeviceFailure
from . import process_supervisor

PREFIX = 'STUDIO_VOCAL '
logger = logging.getLogger(__name__)

class VocalProcess:
    def __init__(self, module="server.vocal_worker"):
        self.module = module
        self._lock = threading.Lock()
        self._process = None
        self._closed = False

    def run(self, request, emit, cancelled):
        from .vocals import VocalCancelled
        with self._lock:
            if self._closed:
                raise RuntimeError('人声工作进程已关闭')
            process = process_supervisor.spawn([sys.executable, '-u', '-m', self.module],
                cwd=Path(__file__).resolve().parent.parent, stdin=subprocess.PIPE,
                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding='utf-8', errors='replace')
            self._process = process
        result = None
        error = None
        try:
            process.stdin.write(json.dumps(request) + '\n'); process.stdin.flush()
            for line in process.stdout:
                if not line.startswith(PREFIX):
                    logger.debug('model worker emitted diagnostic output')
                    continue
                message = json.loads(line[len(PREFIX):])
                if message['kind'] == 'boundary':
                    process.stdin.write(json.dumps({'cancel': cancelled()}) + '\n'); process.stdin.flush()
                elif message['kind'] == 'event':
                    emit(*message['values'])
                elif message['kind'] == 'result':
                    result = message['value']
                elif message['kind'] == 'error':
                    error = message
            code = process.wait()
            if error:
                if error['type'] == 'device': raise DeviceFailure(error['stage'], error['device'])
                if error['type'] == 'cancelled': raise VocalCancelled()
                if error['type'] == 'unavailable': raise EngineUnavailable(error['message'])
                raise RuntimeError(error['message'])
            if code or result is None:
                raise RuntimeError(f'人声工作进程异常退出（exit={code}），详见服务日志')
            return result
        finally:
            self._stop(process)
            process.stdin.close(); process.stdout.close()
            with self._lock:
                if self._process is process: self._process = None

    @staticmethod
    def _stop(process):
        process_supervisor.stop(process)

    def close(self):
        with self._lock:
            self._closed = True
            process = self._process
        if process is not None: self._stop(process)
