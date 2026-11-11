import os
import uuid
from pathlib import Path

import psycopg
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from main import app, database
from auth import current_user
import classification_runs as runs


@pytest.mark.skipif(not os.environ.get('TEST_DATABASE_URL'), reason='TEST_DATABASE_URL fehlt')
def test_run_snapshot_persistence_isolation_and_retry(monkeypatch):
    url = os.environ['TEST_DATABASE_URL'].replace('-pooler.', '.')
    schema = 'runs_test_' + uuid.uuid4().hex
    with psycopg.connect(url, autocommit=True) as c:
        c.execute(f'CREATE SCHEMA {schema}')
    def connect():
        return psycopg.connect(url, options=f'-c search_path={schema}', row_factory=dict_row)
    def db():
        with connect() as c:
            yield c
    who = {'id': 1}
    calls = []
    def classify(data, connection, user, **kwargs):
        calls.append(kwargs)
        if len(calls) == 2:
            raise HTTPException(503,'Testfehler')
        return {'prediction': {'category':'G'}, 'reference':kwargs['row']['category'], 'model':kwargs['model']}
    monkeypatch.setattr(runs, 'execute_classification', classify)
    app.dependency_overrides[database] = db
    app.dependency_overrides[current_user] = lambda: who
    try:
        with connect() as c:
            c.execute(Path(__file__).with_name('schema.sql').read_text())
            c.execute("INSERT INTO app_users (username,password_hash) VALUES ('one','unused'),('two','unused')")
            c.execute("INSERT INTO moneta_records (osm_type,osm_id,name,category,data) VALUES ('way',1,'Original','G',%s)", (Jsonb({'tags':{'name':'Original','website':'original text'}}),))
        client = TestClient(app, headers={'origin':'http://localhost:5173'})
        data = {'name':'Baseline','sources':{'text':True,'osm':False,'satellite':False},'items':[{'osm_type':'way','osm_id':1}]}
        first = client.post('/api/classification/runs',json=data)
        assert first.status_code == 201, first.text
        first = first.json()['id']
        second = client.post('/api/classification/runs',json=data | {'name':'Second'}).json()['id']
        with connect() as c:
            c.execute("UPDATE moneta_records SET name='Changed',category='A',data='{}'")
        path=f'/api/classification/runs/{first}/items/0'
        assert client.post(path).status_code == 200
        assert client.post(path).status_code == 200  # cached, never charge twice for a completed item
        assert len(calls) == 1
        assert calls[0]['row']['name'] == 'Original'
        assert calls[0]['row']['input_features']['website'] == 'original text'
        stored = client.get(f'/api/classification/runs/{first}').json()
        assert stored['items'][0]['state'] == 'done' and stored['items'][0]['reference'] == 'G'
        other=f'/api/classification/runs/{second}/items/0'
        assert client.post(other).status_code == 503
        assert client.get(f'/api/classification/runs/{second}').json()['items'][0]['state'] == 'error'
        assert client.post(other).status_code == 409
        assert client.post(other+'?retry=true').status_code == 200
        assert len(calls) == 3
        third = client.post('/api/classification/runs',json=data | {'name':'Interrupted'}).json()['id']
        with connect() as c:
            c.execute("UPDATE classification_run_items SET state='running',started_at=now() WHERE run_id=%s", (third,))
        third_path=f'/api/classification/runs/{third}/items/0'
        assert client.post(third_path+'?retry=true').status_code == 409
        with connect() as c:
            c.execute("UPDATE classification_run_items SET started_at=now()-interval '6 minutes' WHERE run_id=%s", (third,))
        assert client.post(third_path).status_code == 409
        assert client.post(third_path+'?retry=true').status_code == 200
        assert len(calls) == 4
        who['id'] = 2
        assert client.get(f'/api/classification/runs/{first}').status_code == 404
        assert client.post(path).status_code == 404
        assert client.get('/api/classification/runs').json()['total'] == 0
    finally:
        app.dependency_overrides.clear()
        with psycopg.connect(url, autocommit=True) as c:
            c.execute(f'DROP SCHEMA {schema} CASCADE')
