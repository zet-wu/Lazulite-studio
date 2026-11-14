import json

from fastapi import FastAPI
from fastapi.testclient import TestClient

from server.runtime_settings import RuntimeSettings, settings_router


def test_timeline_preferences_api_persist_and_validate(tmp_path):
    path = tmp_path / 'settings.json'
    settings = RuntimeSettings(path)
    app = FastAPI()
    app.include_router(settings_router(settings, auth=lambda: None, write=lambda: None), prefix='/api/v1')
    with TestClient(app) as client:
        def save(changes):
            response = client.get('/api/v1/settings')
            return client.patch('/api/v1/settings', headers={'If-Match': response.headers['ETag']}, json={'changes': changes})

        for enabled in (False, True):
            layers = json.dumps({'line': enabled, 'staging': enabled, 'spectrum': False})
            assert save({'studio:timeline-layers': layers}).status_code == 200
            assert RuntimeSettings(path).read()['values']['studio:timeline-layers'] == layers
        for ignored in (' ', '', ' ，😀'):
            assert save({'studio:staging-ignored-characters': ignored}).status_code == 200
            assert RuntimeSettings(path).read()['values']['studio:staging-ignored-characters'] == ignored
        before = settings.read()
        for invalid in ('[]', '{"line":"false"}', '{"unknown":true}', 'invalid'):
            assert save({'studio:timeline-layers': invalid}).status_code == 422
            assert settings.read() == before
        assert save({'studio:timeline-layers': None, 'studio:staging-ignored-characters': None}).status_code == 200
        assert RuntimeSettings(path).read()['values'] == {}
