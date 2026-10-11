import os
import sys
import time
import pytest
from server.process_supervisor import spawn, stop


@pytest.mark.skipif(os.name == 'nt', reason='POSIX process group assertion; Windows Job Object requires native runner')
def test_grandchild_is_killed_after_leader_exits(tmp_path):
    marker = tmp_path / 'alive'
    child = "from pathlib import Path; import time; p=Path(" + repr(str(marker)) + ");\nwhile True: p.write_text(str(time.monotonic())); time.sleep(.03)"
    leader = 'import subprocess,sys; subprocess.Popen([sys.executable,"-c",' + repr(child) + '])'
    process = spawn([sys.executable, '-c', leader])
    process.wait(timeout=3)
    for _ in range(100):
        if marker.exists(): break
        time.sleep(.02)
    assert marker.exists()
    stop(process, grace=.1)
    value = marker.read_text(); time.sleep(.15)
    assert marker.read_text() == value
