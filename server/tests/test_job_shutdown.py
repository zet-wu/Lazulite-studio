import threading
import pytest
from server.db import Database
from server.jobs import JobService
from server.tests.test_jobs import FakeVocal, seed_project


def test_stop_cancels_queue_and_prevents_new_work(tmp_path):
    db = Database(tmp_path / 'studio.sqlite3'); seed_project(db, tmp_path)
    with db.transaction() as c:
        c.execute("INSERT INTO projects VALUES('q','q','a',NULL,'t','t')")
    started, released = threading.Event(), threading.Event()
    calls = []

    class Runner:
        def run(self, pid, asset, request, jid, emit, cancelled):
            calls.append(pid); started.set(); released.wait(3)
            return {'kind': 'alignment'}

        def close(self):
            pass

    service = JobService(db, asset_path=lambda pid: tmp_path / 'audio.wav', vocal_runner=FakeVocal(), alignment_runner=Runner())
    first = service.create('p', 'alignment', {'revision': 'r', 'asset_id': 'a', 'retry_analysis_id': 'v1'})
    assert started.wait(1)
    from server.revisions import RevisionStore
    revision = RevisionStore(db, tmp_path/'projects').create_initial('q', operation_id='init-q')['id']
    second = service.create('q', 'alignment', {'revision': revision, 'asset_id': 'a', 'retry_analysis_id': 'v1'})
    service.begin_stop()
    with pytest.raises(ValueError, match='停止'):
        service.create('q', 'alignment', {'revision': revision, 'asset_id': 'a', 'retry_analysis_id': 'v1'})
    assert service.get(second['id'])['status'] == 'cancelled'
    released.set(); service.close()
    assert calls == ['p']
    assert service.get(first['id'])['status'] == 'cancelled'
