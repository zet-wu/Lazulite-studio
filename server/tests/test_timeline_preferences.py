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


def test_active_line_and_spectrum_preferences_are_atomic_and_portable(tmp_path):
    settings = RuntimeSettings(tmp_path / 'settings.json')
    app = FastAPI()
    app.include_router(settings_router(settings, auth=lambda: None, write=lambda: None), prefix='/api/v1')
    with TestClient(app) as client:
        def save(changes):
            response = client.get('/api/v1/settings')
            return client.patch('/api/v1/settings', headers={'If-Match': response.headers['ETag']}, json={'changes': changes})

        for mode, height in [('always', '36'), ('follow', '72'), ('off', '216')]:
            assert save({'studio:timeline-auto-expand': mode, 'studio:spectrum-height': height, 'studio:timeline-swap-wheel': 'true'}).status_code == 200
            assert RuntimeSettings(settings.path).read()['values']['studio:spectrum-height'] == height
        for value in ('true', 'false'):
            assert save({'studio:timeline-swap-boundary-drag': value}).status_code == 200
            assert RuntimeSettings(settings.path).read()['values']['studio:timeline-swap-boundary-drag'] == value
        before = settings.read()
        assert save({'studio:timeline-swap-boundary-drag': 'yes'}).status_code == 422
        assert settings.read() == before
        for invalid in ('35', '217', '72.5', '', 'NaN', 'Infinity', '７２'):
            assert save({'studio:timeline-auto-expand': 'always', 'studio:spectrum-height': invalid}).status_code == 422
            assert settings.read() == before
        for invalid in ('true', '', 'playing'):
            assert save({'studio:timeline-auto-expand': invalid}).status_code == 422
        assert save({'studio:timeline-swap-wheel': 'yes'}).status_code == 422
        assert save({key: None for key in before['values']}).status_code == 200
        assert RuntimeSettings(settings.path).read()['values'] == {}
