import threading
import pytest
from server.db import Database
from server.jobs import JobService
from server.tests.test_jobs import seed_project


def test_stop_cancels_queue_and_prevents_new_work(tmp_path):
    db = Database(tmp_path / 'studio.sqlite3'); seed_project(db, tmp_path)
    with db.transaction() as c:
        c.execute("INSERT INTO projects VALUES('q','q',NULL,NULL,'t','t')")
    started, released = threading.Event(), threading.Event()
    calls = []
    class Runner:
        def run(self, pid, request):
            calls.append(pid); started.set(); released.wait(3)
            return {'kind':'publish'}
    service = JobService(db, publish_runner=Runner())
    first = service.create('p','publish',{'revision':'r','asset_id':'a'})
    assert started.wait(1)
    second = service.create('q','publish',{})
    service.begin_stop()
    with pytest.raises(ValueError, match='停止'): service.create('q','publish',{})
    assert service.get(second['id'])['status'] == 'cancelled'
    released.set(); service.close()
    assert calls == ['p']
    assert service.get(first['id'])['status'] == 'cancelled'
