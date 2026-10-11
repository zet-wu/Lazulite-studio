"""Device selection is a bounded child probe and an immutable per-job snapshot."""
import json
import os
import subprocess
import sys
from . import process_supervisor

LABELS = {'cpu': 'CPU', 'cuda': 'NVIDIA GPU', 'mps': 'Apple GPU'}


class DeviceFailure(RuntimeError):
    def __init__(self, stage, device):
        self.stage, self.device = stage, device
        super().__init__(f'{"人声分离" if stage == "vocal" else "自动对齐"}的 {LABELS.get(device, device)} 计算失败，可使用 CPU 重试')


def device_failure(error, device):
    if device == 'cpu': return False
    text = str(error).lower()
    return isinstance(error, RuntimeError) and any(term in text for term in ('cuda', 'cublas', 'cudnn', 'mps', 'metal', 'out of memory', 'not implemented for'))


def probe(preferred):
    try:
        result = process_supervisor.run([sys.executable, '-m', 'server.runtime_devices', preferred], capture_output=True, text=True, timeout=25)
        if result.returncode: raise ValueError()
        return json.loads(result.stdout)
    except (OSError, ValueError, subprocess.TimeoutExpired):
        return {'actual': 'cpu', 'reason': '设备探测未完成，将尝试 CPU；若运行时无法加载，请使用完整 CPU 包', 'runtime_ok': False}


class RuntimeDevices:
    def __init__(self, settings=None, manifest=None, probe_fn=probe):
        self.settings, self.manifest, self.probe = settings, manifest, probe_fn

    def snapshot(self, kind, *, cpu_retry=False):
        values = self.settings.read()['values'] if self.settings else {}
        target = (self.manifest or {}).get('target')
        automatic = {'windows-x64-cpu': 'cpu', 'windows-x64-cuda': 'cuda', 'macos-arm64': 'mps'}.get(target, 'cpu')
        snapshots = {}
        for stage in (('vocal', 'alignment') if kind == 'alignment' else ('vocal',)):
            if target:
                preference = values.get('device.' + stage, 'auto')
                preferred = 'cpu' if cpu_retry or preference == 'cpu' else automatic
                resolved = self.probe(preferred)
            else:
                preferred = 'cpu' if cpu_retry else os.getenv('STUDIO_VOCAL_DEVICE' if stage == 'vocal' else 'STUDIO_ALIGNMENT_DEVICE', 'cpu')
                # Private deployments keep their explicitly configured behavior.
                resolved = {'actual': preferred, 'reason': None, 'runtime_ok': True}
            snapshots[stage] = {'preferred': preferred, **resolved, 'label': LABELS.get(resolved['actual'], resolved['actual'])}
        return snapshots


def main(device):
    try:
        import torch
    except (ImportError, OSError):
        print(json.dumps({'actual':'cpu', 'reason':'Torch 运行时加载失败，请恢复运行时或使用 CPU 包', 'runtime_ok':False})); return
    reason = None
    actual = device
    try:
        available = device == 'cpu' or device == 'cuda' and torch.cuda.is_available() or device == 'mps' and torch.backends.mps.is_available()
        if not available: raise RuntimeError('unavailable')
        value = torch.ones((4, 4), device=device)
        assert torch.isfinite(value @ value).all().item()
    except (RuntimeError, AssertionError):
        actual = 'cpu'; reason = f'{LABELS.get(device, device)} 不可用，准备阶段选择 CPU'
        try:
            value = torch.ones((4, 4), device='cpu')
            assert torch.isfinite(value @ value).all().item()
        except (RuntimeError, AssertionError):
            print(json.dumps({'actual':'cpu', 'reason':'CPU 计算检查也失败，请恢复完整运行时', 'runtime_ok':False})); return
    print(json.dumps({'actual':actual, 'reason':reason, 'runtime_ok':True}))


if __name__ == '__main__': main(sys.argv[1])
