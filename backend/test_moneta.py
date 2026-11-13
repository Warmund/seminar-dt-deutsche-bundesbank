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
def test_import_and_image_lifecycle(monkeypatch):
    import image_storage
    monkeypatch.setattr(image_storage, "configured", lambda: True)
    monkeypatch.setattr(image_storage, "save_image", lambda *args: "test/image.png")
    monkeypatch.setattr(image_storage, "download_url", lambda key: "https://storage.example/" + key)
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
            c.execute("INSERT INTO app_users(username,password_hash) VALUES('tester','unused')")
        app.dependency_overrides[database] = db
        app.dependency_overrides[current_user] = lambda: {'id': 1, 'username': 'tester'}
        with TestClient(app, headers={'Origin': 'http://localhost:5173'}) as client:
            dirty = sample() | {'tags': {'name': 'Testfirma', 'website': 'Haar- & K\x00örperpflege'}}
            imported = client.post('/api/moneta/records', json=dirty)
            assert imported.status_code == 200
            assert imported.json()['removed_null_characters'] == 1
            assert client.get('/api/moneta/records/way/123').json()['tags']['website'] == 'Haar- & Körperpflege'
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
            assert client.get(path, follow_redirects=False).status_code == 307
            assert client.get(path, follow_redirects=False).headers["location"] == "https://storage.example/test/image.png"
            assert client.get('/api/moneta/records').json()['items'][0]['satellite'] is True
            assert client.get('/api/moneta/records/way/123').json()['website'] == 'https://example.org'
            assert client.put('/api/moneta/records/node/999/images/osm', content=png.getvalue()).status_code == 404
            created=client.post('/api/moneta/datasets',json={'name':'Second dataset'})
            assert created.status_code==201
            dataset_id=created.json()['id']
            assert client.post('/api/moneta/datasets',json={'name':'Second dataset'}).status_code==409
            other=sample()|{'category':'B','tags':{'name':'Other company','website':'Other text'}}
            assert client.post(f'/api/moneta/records?dataset_id={dataset_id}',json=other).status_code==200
            second=client.get(f'/api/moneta/records?dataset_id={dataset_id}').json()
            assert second['total']==1 and second['items'][0]['name']=='Other company'
            assert not second['items'][0]['satellite']
            assert client.get('/api/moneta/records').json()['items'][0]['name']=='Updated'
            assert client.get('/api/moneta/records').json()['items'][0]['satellite']
            assert client.get(f'{path}?dataset_id={dataset_id}',follow_redirects=False).status_code==404
            monkeypatch.setattr(image_storage,'save_image',lambda *args:'test/second.png')
            assert client.put(f'{path}?dataset_id={dataset_id}',content=png.getvalue()).status_code==200
            assert client.get(f'{path}?dataset_id={dataset_id}',follow_redirects=False).headers['location']=='https://storage.example/test/second.png'
            assert client.get(path,follow_redirects=False).headers['location']=='https://storage.example/test/image.png'
            assert client.get(f'/api/classification/dataset?dataset_id={dataset_id}').json()['total']==1
            payload={'name':'Other run','dataset_id':dataset_id,'model':'gpt-6-luna','sources':{'text':True,'osm':False,'satellite':False},'selection':{'count':1,'classes':['B']}}
            new_run=client.post('/api/classification/runs',json=payload)
            assert new_run.status_code==201,new_run.text
            run=client.get('/api/classification/runs/'+new_run.json()['id']).json()
            assert run['selection']['dataset_name']=='Second dataset'
            assert run['items'][0]['name']=='Other company' and run['items'][0]['reference']=='B'
            assert client.get('/api/moneta/datasets').json()['items'][0]['name']=='MONETA-1000'
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


def test_web_text_null_characters_are_cleaned():
    from moneta_api import clean_text
    raw = sample() | {'tags': {'name': 'Firma', 'website': 'Haar- & K\x00örperpflege'}, 'sources': {'wikipedia': 'Text\x00'}, 'extra': ['a\x00b', 42]}
    cleaned, count = clean_text(raw)
    assert count == 3
    assert cleaned['tags']['website'] == 'Haar- & Körperpflege'
    assert cleaned['extra'] == ['ab', 42]
    assert raw['tags']['website'] == 'Haar- & K\x00örperpflege'
    with pytest.raises(ValueError):
        clean_text({'bad\x00key': 'value'})
