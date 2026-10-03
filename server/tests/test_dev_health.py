import urllib.error
from dev import health_expired, probe_endpoint


def test_runtime_overload_can_recover_but_startup_and_persistent_failure_are_bounded():
    assert not health_expired(0, True, {'api': 10}, 20)
    assert health_expired(0, True, {'api': 10}, 40)
    assert not health_expired(0, True, {}, 100)
    assert health_expired(0, False, {'vite': 0}, 21)


def test_probe_records_failure_and_authenticated_endpoint_is_alive():
    class Opener:
        def __init__(self, error): self.error = error
        def open(self, *args, **kwargs): raise self.error
    ok, elapsed, reason = probe_endpoint(Opener(TimeoutError('slow')), 8000, '/api/v1/session')
    assert not ok and elapsed >= 0 and 'TimeoutError' in reason
    error = urllib.error.HTTPError('http://localhost', 401, 'auth', {}, None)
    assert probe_endpoint(Opener(error), 8000, '/api/v1/session')[0]
    error = urllib.error.HTTPError('http://localhost', 503, 'busy', {}, None)
    assert not probe_endpoint(Opener(error), 8000, '/api/v1/session')[0]
