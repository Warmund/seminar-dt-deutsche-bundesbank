from types import SimpleNamespace

from fastapi.testclient import TestClient

from main import app, database
from auth import current_user
import classification_api as api


def test_only_allowed_features_and_bounded_text():
    features = api.text_features({'category': 'SECRET', 'history': 'SECRET', 'tags': {'name': 'Shop', 'category': 'SECRET', 'website': 'x' * 50000}, 'sources': {'website': 'y' * 50000}})
    assert 'SECRET' not in str(features)
    assert sum(map(len, features.values())) <= 24000
    assert len(features['website']) <= 6000


def test_classification_boundaries_and_reference_separation(monkeypatch):
    class Connection:
        def execute(self, sql, args=()):
            self.sql = sql
            return self
        def fetchone(self):
            if 'moneta_records' in self.sql:
                return {'name': 'Test', 'category': 'SECRET_REFERENCE', 'data': {'category': 'SECRET_REFERENCE', 'tags': {'name': 'Test', 'shop': 'bakery'}}}
            if 'count(*)' in self.sql:
                return {'n': 0}
            return None
        def commit(self): pass

    calls = []
    class FakeClient:
        def __init__(self, **kwargs): self.responses = self
        def __enter__(self): return self
        def __exit__(self, *args): pass
        def parse(self, **kwargs):
            calls.append(kwargs)
            return SimpleNamespace(status='completed', output_parsed=api.Prediction(category='G', explanation='Shop', evidence=['bakery'], uncertainty=''), model='test', usage=None)

    monkeypatch.setattr(api, 'OpenAI', FakeClient)
    monkeypatch.setenv('OPENAI_API_KEY', 'test-only')
    app.dependency_overrides[database] = lambda: Connection()
    app.dependency_overrides[current_user] = lambda: {'id': 1}
    try:
        client = TestClient(app)
        body = {'osm_type': 'way', 'osm_id': 123, 'sources': {'text': True, 'osm': False, 'satellite': False}}
        assert client.post('/api/classification', json=body).status_code == 403
        response = client.post('/api/classification', headers={'origin': 'http://localhost:5173'}, json=body)
        assert response.status_code == 200
        assert response.json()['prediction']['category'] == 'G'
        assert response.json()['reference'] == 'SECRET_REFERENCE'
        assert 'SECRET_REFERENCE' not in str(calls)
        assert calls[0]['store'] is False
        monkeypatch.delenv('OPENAI_API_KEY')
        assert client.post('/api/classification', headers={'origin': 'http://localhost:5173'}, json=body).status_code == 503
        app.dependency_overrides.pop(current_user)
        assert client.get('/api/classification/status').status_code == 401
    finally:
        app.dependency_overrides.clear()


def test_verbalized_confidence_schema_and_legacy_compatibility(monkeypatch):
    from pydantic import ValidationError
    import pytest

    for invalid in (-0.01, 1.01, float('nan')):
        with pytest.raises(ValidationError):
            api.ConfidencePrediction(category='G', explanation='', evidence=[], uncertainty='', confidence=invalid)

    formats = []
    class FakeClient:
        def __init__(self, **kwargs): self.responses = self
        def __enter__(self): return self
        def __exit__(self, *args): pass
        def parse(self, **kwargs):
            formats.append(kwargs['text_format'])
            return SimpleNamespace(status='completed', output_parsed=api.Prediction(category='G', explanation='', evidence=[], uncertainty=''), model='test', usage=None)
    monkeypatch.setattr(api, 'OpenAI', FakeClient)
    monkeypatch.setenv('OPENAI_API_KEY', 'test-only')
    monkeypatch.setattr(api, 'reserve_request', lambda connection, user: None)
    api.model_call(None, {'id': 1}, 'test', 'old prompt', [])
    api.model_call(None, {'id': 1}, 'test', 'VERBALIZED_CONFIDENCE_V1', [])
    assert formats == [api.Prediction, api.ConfidencePrediction]


def test_openai_429_distinguishes_credit_and_rate_limits(monkeypatch):
    import httpx
    import pytest
    from fastapi import HTTPException
    from openai import RateLimitError

    code = 'credit_balance_exhausted'
    class FakeClient:
        def __init__(self, **kwargs): self.responses = self
        def __enter__(self): return self
        def __exit__(self, *args): pass
        def parse(self, **kwargs):
            response = httpx.Response(429, request=httpx.Request('POST', 'https://api.openai.com/v1/responses'))
            raise RateLimitError('rate limited', response=response, body={'code': code})
    monkeypatch.setattr(api, 'OpenAI', FakeClient)
    monkeypatch.setattr(api, 'reserve_request', lambda *args: None)
    monkeypatch.setenv('OPENAI_API_KEY', 'test-only')
    with pytest.raises(HTTPException) as error:
        api.model_call(None, {'id': 1}, 'gpt-5-mini', '', [])
    assert 'Guthaben' in error.value.detail
    code = 'rate_limit_exceeded'
    with pytest.raises(HTTPException) as error:
        api.model_call(None, {'id': 1}, 'gpt-5-mini', '', [])
    assert 'Anfragelimit' in error.value.detail and 'Guthaben' not in error.value.detail
