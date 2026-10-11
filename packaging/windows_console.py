"""Send real console events from an isolated helper, never to the CI console."""
import ctypes
import sys
import time


def send(pid, event):
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    kernel.FreeConsole()
    if not kernel.AttachConsole(int(pid)):
        raise ctypes.WinError(ctypes.get_last_error())
    handler_type = ctypes.WINFUNCTYPE(ctypes.c_int, ctypes.c_ulong)
    handler = handler_type(lambda event: 1)
    kernel.SetConsoleCtrlHandler.argtypes = [handler_type, ctypes.c_int]
    kernel.SetConsoleCtrlHandler(handler, True)
    try:
        for _ in range(2):
            if not kernel.GenerateConsoleCtrlEvent(int(event), 0):
                raise ctypes.WinError(ctypes.get_last_error())
            time.sleep(.05)
    finally:
        kernel.FreeConsole()


if __name__ == '__main__':
    send(*sys.argv[1:])
