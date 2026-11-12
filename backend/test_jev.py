import json
import io

import pytest

import main  # Initialize application routes before importing adapters.
import jev_api as jev


def test_jev_payload_and_probability_result(monkeypatch):
    monkeypatch.setenv('OPENCODE_API_KEY','test-only')
    monkeypatch.setattr(jev,'gateway_post',lambda *args: pytest.fail('OpenCode must not use the Vercel pause'))
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


def test_decider_gateway_choice_and_images(monkeypatch):
    from PIL import Image
    import base64
    monkeypatch.setenv('VERCEL_API_KEY', 'test-only')
    monkeypatch.setenv('MONETA_IMAGE_BUCKET', 'test-bucket')
    monkeypatch.setattr(jev.image_storage, 'configured', lambda: True)
    original = io.BytesIO()
    Image.new('RGB', (1800, 1800), 'red').save(original, format='PNG')
    class Storage:
        def get_object(self, **kwargs): return {'Body': io.BytesIO(original.getvalue())}
    monkeypatch.setattr(jev.image_storage, 'client', lambda: Storage())
    calls = []
    class Response:
        status_code = 200
        def json(self): return {'answers': {'nace': {'type': 'choice', 'choice': 'G', 'confidence': 0.7, 'probabilities': {'G': 0.8, 'C': 0.2}}}, 'usage': {'input_tokens': 123}}
    class Client:
        def __init__(self, **kwargs): pass
        def __enter__(self): return self
        def __exit__(self, *args): pass
        def post(self, url, **kwargs):
            calls.append((url, kwargs))
            return Response()
    monkeypatch.setattr(jev.httpx, 'Client', Client)
    monkeypatch.setattr(jev, 'gateway_post', lambda connection, client, headers, payload: client.post(jev.GATEWAY_ENDPOINT, headers=headers, json=payload))
    item = {'name': 'Bakery', 'reference': 'PRIVATE_REFERENCE', 'snapshot': {'texts': {'website': 'Bakery'}, 'images': {'osm': {'object_key': 'private-key'}}}}
    run = {'model': jev.DECIDER_MODEL, 'prompt': json.dumps(jev.build_questions('Simple')), 'sources': {'text': True, 'osm': True, 'satellite': False}}
    result = jev.classify_jev(run, item, None, None)
    url, request = calls[0]
    assert url == jev.GATEWAY_ENDPOINT
    assert result['prediction']['category'] == 'G' and result['confidence'] == 0.7
    assert result['confidence_method'] == 'decider_distribution' and result['provider'] == 'vercel'
    payload = request['json']
    assert 'PRIVATE_REFERENCE' not in str(payload) and 'private-key' not in str(payload)
    assert 'UNK' not in payload['questions']['nace']['criteria'] and 'assets' not in payload
    image_url = payload['state']['osm']['image_url']['url']
    assert image_url.startswith('data:image/png;base64,')
    with Image.open(io.BytesIO(base64.b64decode(image_url.split(',', 1)[1]))) as image:
        assert image.size == (1400, 1400)


def test_gateway_waits_four_seconds_and_releases_lock_on_error():
    events = []
    class Connection:
        def execute(self, query, params=None): events.append((query, params))
        def commit(self): events.append(('commit', None))
    class Client:
        def post(self, *args, **kwargs):
            events.append(('post', None))
            raise jev.httpx.ReadTimeout('timeout')
    with pytest.raises(jev.httpx.ReadTimeout):
        jev.gateway_post(Connection(), Client(), {}, {})
    assert events == [
        ('SELECT pg_advisory_xact_lock(%s, %s)', (1447187280, 4)),
        ('post', None),
        ('SELECT pg_sleep(4)', None),
        ('commit', None),
    ]


def test_gateway_requests_share_lock_across_connections():
    import threading
    import time
    shared_lock = threading.Lock()
    events = []
    class Connection:
        def __init__(self, name): self.name = name
        def execute(self, sql, params=None):
            if 'pg_advisory_xact_lock' in sql:
                shared_lock.acquire()
            elif 'pg_sleep' in sql:
                assert sql == 'SELECT pg_sleep(4)'
                events.append((self.name, 'pause'))
                time.sleep(0.02)
        def commit(self):
            events.append((self.name, 'release'))
            shared_lock.release()
    class Client:
        def __init__(self, name): self.name = name
        def post(self, *args, **kwargs):
            events.append((self.name, 'request'))
    threads = [threading.Thread(target=jev.gateway_post, args=(Connection(name), Client(name), {}, {})) for name in ('a', 'b')]
    for thread in threads: thread.start()
    for thread in threads: thread.join()
    for i in (0, 3):
        name = events[i][0]
        assert events[i:i+3] == [(name, 'request'), (name, 'pause'), (name, 'release')]
