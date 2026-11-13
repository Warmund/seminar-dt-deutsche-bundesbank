"""Exercise persistent blind-first review without external model requests."""
import os
import uuid
from pathlib import Path
import psycopg
import pytest
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from fastapi import HTTPException
import main
import review_api as review

@pytest.mark.skipif(not os.environ.get('TEST_DATABASE_URL'),reason='TEST_DATABASE_URL fehlt')
def test_blind_review_and_persistence(monkeypatch):
    url=os.environ['TEST_DATABASE_URL'].replace('-pooler.','.')
    schema='review_test_'+uuid.uuid4().hex
    with psycopg.connect(url,autocommit=True) as c: c.execute(f'CREATE SCHEMA {schema}')
    import classification_api
    from types import SimpleNamespace
    monkeypatch.setattr(classification_api,'model_call',lambda *a,**k:(SimpleNamespace(model='test-model'),'Gespeicherte Quellen sprechen für G.'))
    user={'id':1,'is_admin':True}
    run_id=uuid.uuid4()
    try:
        with psycopg.connect(url,options=f'-c search_path={schema}',row_factory=dict_row) as c:
            c.execute(Path(__file__).with_name('schema.sql').read_text())
            c.execute("INSERT INTO app_users(username,password_hash) VALUES('tester','unused')")
            c.execute("INSERT INTO classification_runs(id,user_id,name,model,prompt,sources) VALUES(%s,1,'Test','gpt-5-mini','test','{}')",(run_id,))
            c.execute("INSERT INTO classification_run_items(run_id,position,osm_type,osm_id,name,reference,snapshot,state,result) VALUES(%s,0,'way',1,'Test','G','{}','done',%s)",(run_id,Jsonb({'prediction':{'category':'G'},'confidence':0.7})))
            for position,reference,prediction,confidence in [(1,'C','G',0.7),(2,'H','H',0.99)]:
                c.execute("INSERT INTO classification_run_items(run_id,position,osm_type,osm_id,name,reference,snapshot,state,result) VALUES(%s,%s,'way',%s,'Extra',%s,'{}','done',%s)",(run_id,position,position+1,reference,Jsonb({'prediction':{'category':prediction},'confidence':confidence})))
            review.configure(run_id,review.Settings(variant='B'),c,user)
            hidden=review.review(run_id,c,user)['items'][0]
            assert hidden['result'] is None and 'reference' not in hidden
            with pytest.raises(HTTPException) as err: review.act(run_id,0,review.Action(action='save',code='G',certainty=4),c,user)
            assert err.value.status_code==409
            review.act(run_id,0,review.Action(action='reveal',code='C',certainty=3),c,user)
            shown=review.review(run_id,c,user)['items'][0]
            assert shown['result']['prediction']['category']=='G' and shown['initial_code']=='C'
            review.act(run_id,0,review.Action(action='chat',question='Welche Quellen?'),c,user)
            assert review.review(run_id,c,user,position=0)['items'][0]['messages'][0]['answer']=='Gespeicherte Quellen sprechen für G.'
            review.act(run_id,0,review.Action(action='save',code='G',certainty=4,comment='Belege geprüft'),c,user)
            assert review.export(run_id,c,user)['entries'][0]['final_code']=='G'
            assert not review.review_progress(c,user)['items'][0]['completed']
            review.act(run_id,1,review.Action(action='defer'),c,user)
            assert review.review_progress(c,user)['items'][0]['open']==1
            with pytest.raises(HTTPException):review.evaluation(run_id,1,c,user)
            review.act(run_id,1,review.Action(action='reveal',code='C',certainty=4),c,user)
            review.act(run_id,1,review.Action(action='save',code='C',certainty=4),c,user)
            complete=review.review_progress(c,user)['items'][0]
            assert complete['completed'] and complete['username']=='tester'
            metrics=review.evaluation(run_id,1,c,user)['metrics']
            assert metrics['human_correct']==2 and metrics['fixed']==1 and metrics['overall_correct']==3
            with pytest.raises(HTTPException):review.act(run_id,0,review.Action(action='save',code='A',certainty=1),c,user)
            with pytest.raises(HTTPException):review.evaluation(run_id,1,c,{'id':999,'is_admin':False})

            assert review.review(run_id,c,{'id':999,'is_admin':False})['items'][0]['result'] is None
            with pytest.raises(HTTPException): review.review(uuid.uuid4(),c,{'id':999,'is_admin':False})
    finally:
        with psycopg.connect(url,autocommit=True) as c: c.execute(f'DROP SCHEMA {schema} CASCADE')
