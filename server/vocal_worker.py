"""Private newline protocol for the supervised vocal worker; no HTTP or new history."""
import json
import sys
import traceback
from pathlib import Path
from .db import Database
from .engine import EngineUnavailable
from .vocal_process import PREFIX
from .vocals import VocalRunner, VocalCancelled


def main():
    def send(kind, **values):
        print(PREFIX + json.dumps({'kind': kind, **values}), flush=True)
    request = json.loads(sys.stdin.readline())
    def cancelled():
        send('boundary')
        response = sys.stdin.readline()
        if not response: raise VocalCancelled()
        return json.loads(response)['cancel']
    try:
        # Only the API startup cleans unregistered files, never a running job's child.
        runner = VocalRunner(Database(request['database']), Path(request['root']), cleanup=False)
        result = runner.run_in_process(request['project_id'], Path(request['asset_path']), request['params'], request['job_id'],
            lambda *values: send('event', values=values), cancelled)
        send('result', value=result)
        return 0
    except VocalCancelled:
        send('error', type='cancelled', message='人声任务已在阶段边界停止')
    except EngineUnavailable as exc:
        send('error', type='unavailable', message=str(exc))
    except Exception as exc:
        traceback.print_exc()
        send('error', type='failed', message=str(exc))
    return 1

if __name__ == '__main__':
    sys.exit(main())
