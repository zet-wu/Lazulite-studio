"""Registered process groups (POSIX) / kill-on-close jobs (Windows)."""
import os
import signal
import subprocess
import threading
import time

_lock = threading.RLock()
_active = {}


class WindowsJob:
    def __init__(self, process):
        import ctypes
        from ctypes import wintypes as w
        class Basic(ctypes.Structure):
            _fields_ = [('per_process', ctypes.c_int64), ('per_job', ctypes.c_int64), ('flags', w.DWORD), ('min_ws', ctypes.c_size_t), ('max_ws', ctypes.c_size_t), ('active', w.DWORD), ('affinity', ctypes.c_size_t), ('priority', w.DWORD), ('scheduling', w.DWORD)]
        class IO(ctypes.Structure):
            _fields_ = [(name, ctypes.c_uint64) for name in ('read_ops', 'write_ops', 'other_ops', 'read_bytes', 'write_bytes', 'other_bytes')]
        class Extended(ctypes.Structure):
            _fields_ = [('basic', Basic), ('io', IO), ('process_memory', ctypes.c_size_t), ('job_memory', ctypes.c_size_t), ('peak_process', ctypes.c_size_t), ('peak_job', ctypes.c_size_t)]
        self.kernel = ctypes.WinDLL('kernel32', use_last_error=True)
        self.kernel.CreateJobObjectW.argtypes = [ctypes.c_void_p, w.LPCWSTR]
        self.kernel.CreateJobObjectW.restype = w.HANDLE
        self.kernel.SetInformationJobObject.argtypes = [w.HANDLE, ctypes.c_int, ctypes.c_void_p, w.DWORD]
        self.kernel.AssignProcessToJobObject.argtypes = [w.HANDLE, w.HANDLE]
        self.kernel.CloseHandle.argtypes = [w.HANDLE]
        self.handle = self.kernel.CreateJobObjectW(None, None)
        info = Extended(); info.basic.flags = 0x2000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        if not self.handle: raise ctypes.WinError(ctypes.get_last_error())
        if not self.kernel.SetInformationJobObject(self.handle, 9, ctypes.byref(info), ctypes.sizeof(info)) or not self.kernel.AssignProcessToJobObject(self.handle, int(process._handle)):
            error = ctypes.WinError(ctypes.get_last_error()); self.close(); raise error

    def close(self):
        if self.handle:
            self.kernel.CloseHandle(self.handle)
            self.handle = None


def spawn(args, **kwargs):
    if os.name == 'nt': kwargs['creationflags'] = kwargs.get('creationflags', 0) | subprocess.CREATE_NEW_PROCESS_GROUP
    else: kwargs['start_new_session'] = True
    with _lock:
        process = subprocess.Popen(args, **kwargs)
        try:
            job = WindowsJob(process) if os.name == 'nt' else None
        except Exception:
            process.kill(); process.wait(); raise
        _active[process] = job
    return process


def stop(process, grace=2):
    with _lock:
        if process not in _active: return
        job = _active.pop(process)
    if os.name == 'nt':
        job.close()
    else:
        # The leader may have exited while its grandchildren are still alive.
        try: os.killpg(process.pid, signal.SIGTERM)
        except ProcessLookupError: pass
        deadline = time.monotonic() + grace
        while time.monotonic() < deadline:
            try: os.killpg(process.pid, 0)
            except ProcessLookupError: break
            process.poll()
            time.sleep(.02)
        try: os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError: pass
    try: process.wait(timeout=3)
    except subprocess.TimeoutExpired:
        process.kill(); process.wait(timeout=3)


def close_all():
    with _lock: processes = list(_active)
    for process in processes: stop(process)


def run(args, *, check=False, capture_output=False, timeout=None, input=None, **kwargs):
    if capture_output:
        kwargs.update(stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if input is not None: kwargs['stdin'] = subprocess.PIPE
    process = spawn(args, **kwargs)
    try:
        stdout, stderr = process.communicate(input, timeout=timeout)
        result = subprocess.CompletedProcess(args, process.returncode, stdout, stderr)
        if check: result.check_returncode()
        return result
    finally:
        stop(process)
