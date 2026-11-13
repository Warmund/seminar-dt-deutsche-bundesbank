"""Tests use a dedicated temporary Postgres schema; no real models are called."""
import os
import uuid
from pathlib import Path
from types import SimpleNamespace

import psycopg
import pytest
from psycopg.rows import dict_row

import classification_runs as runs
import run_queue
import run_worker


@pytest.mark.skipif(not os.environ.get('TEST_DATABASE_URL'), reason='TEST_DATABASE_URL fehlt')
def test_background_lifecycle_and_redelivery(monkeypatch):
    url = os.environ['TEST_DATABASE_URL'].replace('-pooler.', '.')
    schema = 'worker_test_' + uuid.uuid4().hex
    with psycopg.connect(url, autocommit=True) as conn:
        conn.execute(f'CREATE SCHEMA {schema}')
    def connect():
        return psycopg.connect(url, options=f'-c search_path={schema}', row_factory=dict_row)
    sent, calls = [], []
    def publish(run_id, user_id, generation, position, stage, retry=False, single=False, previous_attempt=None):
        message = {'run_id':str(run_id),'user_id':user_id,'generation':str(generation),'position':position,'stage':stage,'retry':retry,'single':single,'previous_attempt':str(previous_attempt) if previous_attempt else None}
        if message not in sent:
            sent.append(message)
    monkeypatch.setattr(run_queue, 'publish_step', publish)
    monkeypatch.setattr(run_worker, 'publish_step', publish)
    monkeypatch.setattr(run_worker, 'psycopg', SimpleNamespace(connect=lambda *a, **k: connect()))
    monkeypatch.setenv('DATABASE_URL', 'unused-for-test')
    def step(run, item, connection, user):
        calls.append(item['position'])
        if not item['clues']:
            return None, {'website': {'text':'clue'}}
        return {'prediction': {'category':'G'}}, item['clues']
    monkeypatch.setattr(runs, 'next_step', step)
    try:
        with connect() as conn:
            conn.execute(Path(__file__).with_name('schema.sql').read_text())
            conn.execute("INSERT INTO app_users (username,password_hash) VALUES ('worker-test','unused')")
            conn.execute("INSERT INTO moneta_records (osm_type,osm_id,name,category,data) VALUES ('way',1,'One','G','{}'),('way',2,'Two','G','{}')")
            result = runs.create_run(runs.NewRun.model_validate({'name':'Test','model':'gpt-6-luna','sources':{'text':True,'osm':False,'satellite':False},'items':[{'osm_type':'way','osm_id':1},{'osm_type':'way','osm_id':2}]}),conn,{'id':1})
            run_id=uuid.UUID(result['id'])
        with connect() as conn:
            runs.start_background(run_id,runs.StartRun(),conn,{'id':1})
        assert len(sent)==1
        run_worker.process_message(sent[0])
        assert calls==[0] and len(sent)==2 and sent[1]['stage']==1
        run_worker.process_message(sent[0])  # Redelivery must not repeat a model call.
        assert calls==[0] and len(sent)==2
        run_worker.process_message(sent[1])
        assert calls==[0,0] and sent[2]['position']==1
        with connect() as conn:
            runs.stop_background(run_id,conn,{'id':1})
        run_worker.process_message(sent[2])
        assert calls==[0,0]
        with connect() as conn:
            runs.start_background(run_id,runs.StartRun(),conn,{'id':1})
        run_worker.process_message(sent[3])
        run_worker.process_message(sent[4])
        assert calls==[0,0,1,1]
        with connect() as conn:
            state=conn.execute('SELECT runner_state FROM classification_runs WHERE id=%s',(run_id,)).fetchone()
            assert state['runner_state']=='paused'
            assert conn.execute("SELECT count(*) AS n FROM classification_run_items WHERE run_id=%s AND state='done'",(run_id,)).fetchone()['n']==2
            conn.execute("UPDATE classification_run_items SET state='error', result=NULL WHERE run_id=%s AND position=0", (run_id,))
        def failed_step(*args):
            calls.append('failed')
            raise RuntimeError('provider unavailable')
        monkeypatch.setattr(runs, 'next_step', failed_step)
        with connect() as conn:
            runs.start_background(run_id,runs.StartRun(retry_position=0),conn,{'id':1})
        retry_message=sent[-1]
        run_worker.process_message(retry_message)
        assert calls[-1]=='failed'
        with connect() as conn:
            # Simulate a worker disappearing after recording the error but before pausing.
            conn.execute("UPDATE classification_runs SET runner_state='running' WHERE id=%s",(run_id,))
        run_worker.process_message(retry_message)
        assert calls.count('failed')==1
        with connect() as conn:
            assert conn.execute('SELECT runner_state FROM classification_runs WHERE id=%s',(run_id,)).fetchone()['runner_state']=='paused'
    finally:
        with psycopg.connect(url, autocommit=True) as conn:
            conn.execute(f'DROP SCHEMA {schema} CASCADE')
