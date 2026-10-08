"""Private model worker using the same supervised boundary protocol as vocals."""
import json
import sys
import traceback
from lazulite.events import Cancelled
from .vocals import VocalCancelled
from .vocal_process import PREFIX
from .alignment import run_alignment


def main():
    def send(kind, **values): print(PREFIX+json.dumps({'kind':kind,**values}),flush=True)
    request=json.loads(sys.stdin.readline())
    def cancelled():
        send('boundary')
        response=sys.stdin.readline()
        if not response: raise VocalCancelled()
        return json.loads(response)['cancel']
    try:
        result=run_alignment(request, lambda *values:send('event',values=values),cancelled)
        send('result',value=result)
        return 0
    except (Cancelled,VocalCancelled):send('error',type='cancelled',message='自动对齐已取消')
    except Exception as exc:
        traceback.print_exc();send('error',type='failed',message=str(exc))
    return 1

if __name__=='__main__':sys.exit(main())
