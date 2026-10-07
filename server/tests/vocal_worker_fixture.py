"""A child-only stand-in exercising the production supervision protocol."""
import os
import sys
import time
from server.vocal_worker import main
from server.vocals import VocalRunner, VocalCancelled

def run(self, project_id, asset_path, params, job_id, emit, cancelled):
    if cancelled(): raise VocalCancelled()
    emit('stage', 'separating', None, None, 'test worker entered')
    if os.getenv('STUDIO_TEST_VOCAL_CRASH'): os._exit(17)
    # Hold this interpreter's GIL for a measurable interval. API threads must stay live.
    sys.setswitchinterval(10)
    until = time.monotonic() + params.get('seconds', 1)
    while time.monotonic() < until: pass
    if cancelled(): raise VocalCancelled()
    return {'kind': 'vocal', 'analysis_id': job_id, 'engine': {'worker_pid': os.getpid()}}

VocalRunner.run_in_process = run
if __name__ == '__main__': sys.exit(main())
