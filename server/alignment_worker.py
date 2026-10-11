"""Private model worker using the same supervised boundary protocol as vocals."""
import json
import sys
from .runtime_devices import DeviceFailure
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
    except DeviceFailure as exc:
        send('error', type='device', stage=exc.stage, device=exc.device, message=str(exc))
    except (Cancelled,VocalCancelled):send('error',type='cancelled',message='自动对齐已取消')
    except Exception as exc:
        send('error',type='failed',message=f'自动对齐失败（{type(exc).__name__}），请检查模型及输入音频')
    return 1

if __name__=='__main__':sys.exit(main())
