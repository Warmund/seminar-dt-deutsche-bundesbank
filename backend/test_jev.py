import json
import io

import pytest

import main  # Initialize application routes before importing adapters.
import jev_api as jev


def test_jev_payload_and_probability_result(monkeypatch):
    monkeypatch.setenv('OPENCODE_API_KEY','test-only')
    monkeypatch.setattr(jev,'reserve_request',lambda *args: None)
    monkeypatch.setattr(jev.image_storage,'configured',lambda: True)
    class Storage:
        def get_object(self,**kwargs): return {'Body':io.BytesIO(b'png-test-data')}
    monkeypatch.setattr(jev.image_storage,'client',lambda: Storage())
    monkeypatch.setenv('MONETA_IMAGE_BUCKET','test-bucket')
    calls=[]
    class Response:
        status_code=200
        def json(self): return {'model':'jev-1.13','answers':{'nace':{'type':'choice','choice':'G','confidence':0.8,'probabilities':{'G':0.9,'H':0.1}}},'usage':{'input_tokens':100,'output_tokens':0}}
    class Client:
        def __init__(self,**kwargs): pass
        def __enter__(self):return self
        def __exit__(self,*args):pass
        def post(self,url,**kwargs):
            calls.append((url,kwargs))
            return Response()
    monkeypatch.setattr(jev.httpx,'Client',Client)
    item={'name':'Bakery','reference':'SECRET_REFERENCE','snapshot':{'texts':{'website':'Retail bakery'},'images':{'osm':{'object_key':'private-object-key'}}}}
    run={'model':'jev-1.13','prompt':json.dumps(jev.build_questions('Extended')),'sources':{'text':True,'osm':True,'satellite':False}}
    result=jev.classify_jev(run,item,None,None)
    assert 'SECRET_REFERENCE' not in str(calls[0][1]['json'])
    assert set(calls[0][1]['json']['questions']['nace']['criteria'])==jev.CATEGORIES - {'UNK'}
    assert result['confidence']==0.8 and result['prediction']['category']=='G'
    assert result['prediction']['explanation']=='' and result['prediction']['evidence']==[]
    assert result['used_sources']==['osm','website']
    payload=calls[0][1]['json']
    assert payload['state']['osm'] in payload['assets']
    assert calls[0][1]['headers']['TypeSafe-Danger-Zone-Images']=='true'
    assert 'private-object-key' not in str(payload)
    assert payload['assets'][payload['state']['osm']]['format']=='png'
    assert calls[0][0]==jev.ENDPOINT and 'Authorization' in calls[0][1]['headers']


def test_invalid_probabilities_rejected():
    for probabilities in [{'G':float('nan')},{'G':1.1},{'WRONG':1}]:
        with pytest.raises(ValueError):
            jev.ChoiceAnswer(type='choice',choice='G',confidence=0.8,probabilities=probabilities)


def test_jev_new_and_legacy_frozen_choices(monkeypatch):
    from fastapi import HTTPException
    monkeypatch.setenv('OPENCODE_API_KEY', 'test-only')
    monkeypatch.setattr(jev, 'reserve_request', lambda *args: None)
    class Response:
        status_code = 200
        def json(self):
            return {'answers': {'nace': {'type': 'choice', 'choice': 'UNK', 'confidence': 0.8, 'probabilities': {'UNK': 0.8}}}}
    class Client:
        def __init__(self, **kwargs): pass
        def __enter__(self): return self
        def __exit__(self, *args): pass
        def post(self, *args, **kwargs): return Response()
    monkeypatch.setattr(jev.httpx, 'Client', Client)
    questions = jev.build_questions('Simple')
    assert 'UNK' not in questions['nace']['criteria']
    assert 'UNK' not in questions['nace']['instructions']
    item = {'name': 'Test', 'reference': 'G', 'snapshot': {'texts': {}, 'images': {}}}
    run = {'model': 'jev-1.13', 'prompt': json.dumps(questions), 'sources': {'text': True, 'osm': False, 'satellite': False}}
    with pytest.raises(HTTPException) as error:
        jev.classify_jev(run, item, None, None)
    assert error.value.status_code == 502
    questions['nace']['criteria']['UNK'] = 'Insufficient evidence'
    run['prompt'] = json.dumps(questions)
    assert jev.classify_jev(run, item, None, None)['prediction']['category'] == 'UNK'
