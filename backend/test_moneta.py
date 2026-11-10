import io
import os
import uuid
from pathlib import Path

import psycopg
import pytest
from fastapi.testclient import TestClient
from PIL import Image
from main import app, database
from auth import current_user
from moneta_api import Record, verify_png


def sample():
    return {'id': 123, 'type': 'way', 'category': 'A', 'bbox': [8, 50, 9, 51], 'tags': {'name': 'Testfirma', 'website': 'Angereicherter Text'}, 'website': 'https://example.org'}


def test_validates_coordinates_and_identity():
    assert Record.model_validate(sample()).id == 123
    for change in [{'id': True}, {'type': 'unknown'}, {'category': 'invalid'}, {'bbox': [9, 50, 8, 51]}, {'tags': {}}]:
        with pytest.raises(ValueError):
            Record.model_validate(sample() | change)


def test_png_validation():
    with pytest.raises(Exception) as exc:
        verify_png(b'not png')
    assert exc.value.status_code == 422
    image = io.BytesIO()
    Image.new('RGB', (8, 8)).save(image, format='PNG')
    verify_png(image.getvalue())


@pytest.mark.skipif(not os.environ.get('TEST_DATABASE_URL'), reason='TEST_DATABASE_URL fehlt')
def test_import_and_image_lifecycle():
    url = os.environ['TEST_DATABASE_URL']
    schema = 'moneta_test_' + uuid.uuid4().hex
    with psycopg.connect(url, autocommit=True) as c:
        c.execute(f'CREATE SCHEMA {schema}')
    def db():
        with psycopg.connect(url, row_factory=psycopg.rows.dict_row) as c:
            c.execute(f'SET LOCAL search_path TO {schema}')
            yield c
    try:
        with psycopg.connect(url) as c:
            c.execute(f'SET LOCAL search_path TO {schema}')
            c.execute(Path(__file__).with_name('schema.sql').read_text())
        app.dependency_overrides[database] = db
        app.dependency_overrides[current_user] = lambda: {'id': 1, 'username': 'tester'}
        with TestClient(app, headers={'Origin': 'http://localhost:5173'}) as client:
            assert client.post('/api/moneta/records', json=sample()).status_code == 200
            assert client.post('/api/moneta/records', json=sample() | {'tags': {'name': 'Updated'}}).status_code == 200
            result = client.get('/api/moneta/records').json()
            assert result['total'] == 1
            assert result['items'][0]['name'] == 'Updated'
            assert client.get('/api/moneta/records?q=missing').json()['total'] == 0
            assert client.post('/api/moneta/records', json=sample() | {'category': 'bad'}).status_code == 422
            png = io.BytesIO()
            Image.new('RGB', (8, 8)).save(png, format='PNG')
            path = '/api/moneta/records/way/123/images/satellite'
            assert client.put(path, content=png.getvalue()).status_code == 200
            assert client.get(path).content == png.getvalue()
            assert client.get('/api/moneta/records').json()['items'][0]['satellite'] is True
            assert client.get('/api/moneta/records/way/123').json()['website'] == 'https://example.org'
            assert client.put('/api/moneta/records/node/999/images/osm', content=png.getvalue()).status_code == 404
            assert client.put(path, content=b'bad').status_code == 422
            assert client.put(path, content=b'x' * 3_000_001).status_code == 413
            assert client.post('/api/moneta/records', headers={'Origin': 'https://evil.example'}, json=sample()).status_code == 403
        app.dependency_overrides[current_user] = lambda: (_ for _ in ()).throw(__import__('fastapi').HTTPException(401))
        with TestClient(app) as client:
            assert client.get('/api/moneta/records').status_code == 401
    finally:
        app.dependency_overrides.clear()
        with psycopg.connect(url, autocommit=True) as c:
            c.execute(f'DROP SCHEMA {schema} CASCADE')
