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
    def step(run, item, connection, user):
        return classify(None,connection,user,row={'name':item['name'],'category':item['reference'],'input_features':item['snapshot']['texts']},model=run['model']), {}
    monkeypatch.setattr(runs, 'next_step', step)
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
        # Real multi-turn orchestration with fake model responses, including a failed step.
        from types import SimpleNamespace
        from classification_api import Prediction
        import moneta_pipeline as pipeline
        with connect() as c:
            c.execute("UPDATE moneta_records SET name='Original',category='G',data=%s", (Jsonb({'tags':{'website':'unique website source','wikipedia':'unique wiki source','wikidata':'unique data source'}}),))
            for kind in ('osm','satellite'):
                c.execute("INSERT INTO moneta_images (osm_type,osm_id,kind,object_key) VALUES ('way',1,%s,%s)",(kind,'frozen/'+kind))
        multi = client.post('/api/classification/runs',json=data | {'method':'multi_turn','sources':{'text':True,'osm':True,'satellite':True}})
        assert multi.status_code == 201, multi.text
        multi = multi.json()['id']
        with connect() as c:
            c.execute("UPDATE moneta_records SET data='{}',category='A'")
            c.execute("UPDATE moneta_images SET object_key='changed'")
        monkeypatch.setattr(runs,'next_step',pipeline.next_step)
        seen_images=[]
        def image_content(image):
            seen_images.append(image['object_key'])
            return {'type':'input_image','image_url':'https://example.invalid/image.png'}
        monkeypatch.setattr(pipeline,'image_content',image_content)
        model_calls=[]
        def model_call(connection,user,model,prompt,content,clue=False):
            model_calls.append({'content':content,'clue':clue,'prompt':prompt})
            if len(model_calls) == 3:
                raise HTTPException(503,'stage failure')
            response=SimpleNamespace(model='fake',usage=SimpleNamespace(input_tokens=10,output_tokens=2))
            return response, 'saved economic [retail] clue' if clue else Prediction(category='G',explanation='Evidence',evidence=['retail'],uncertainty='')
        monkeypatch.setattr(pipeline,'model_call',model_call)
        multi_path=f'/api/classification/runs/{multi}/items/0'
        assert client.post(multi_path).status_code == 200
        assert client.post(multi_path).status_code == 200
        assert client.post(multi_path).status_code == 503
        partial=client.get(f'/api/classification/runs/{multi}').json()
        assert len(partial['items'][0]['clues']) == 2
        assert partial['items'][0]['state'] == 'error'
        assert client.post(multi_path).status_code == 409
        assert client.post(multi_path+'?retry=true').status_code == 200
        for _ in range(3):
            assert client.post(multi_path).status_code == 200
        final=client.get(f'/api/classification/runs/{multi}').json()
        assert final['method']=='multi_turn' and final['items'][0]['state']=='done'
        assert len(final['items'][0]['clues']) == 5
        assert final['items'][0]['result']['reference'] == 'G'
        assert final['items'][0]['result']['clue_input_tokens'] == 50
        assert seen_images==['frozen/osm','frozen/satellite']
        assert len(model_calls)==7 and model_calls[-1]['clue'] is False
        assert 'unique' not in str(model_calls[-1]['content'])
        assert 'saved economic' in str(model_calls[-1]['content'])
        assert client.post(multi_path).status_code == 200 and len(model_calls)==7
        # Existing runs retain their old prompt and snapshot semantics.
        legacy = client.post('/api/classification/runs',json=data | {'name':'Legacy'}).json()['id']
        with connect() as c:
            c.execute("UPDATE classification_runs SET method='legacy' WHERE id=%s",(legacy,))
            c.execute("UPDATE classification_run_items SET snapshot=%s WHERE run_id=%s",(Jsonb({'data':{'tags':{'website':'legacy text'}},'images':{}}),legacy))
        monkeypatch.setattr(runs,'execute_classification',classify)
        assert client.post(f'/api/classification/runs/{legacy}/items/0').status_code == 200
        assert calls[-1]['row']['input_features']['website']=='legacy text'
        who['id'] = 2
        assert client.get(f'/api/classification/runs/{first}').status_code == 404
        assert client.post(path).status_code == 404
        assert client.get('/api/classification/runs').json()['total'] == 0
    finally:
        app.dependency_overrides.clear()
        with psycopg.connect(url, autocommit=True) as c:
            c.execute(f'DROP SCHEMA {schema} CASCADE')
