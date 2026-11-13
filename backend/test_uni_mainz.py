import json
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

import main  # initialize routes
import uni_mainz as uni


def test_discovery_selects_only_deepseek_and_qwen_chat(monkeypatch):
    monkeypatch.setenv('UNI_MAINZ_API_KEY', 'test-only')
    class Response:
        def raise_for_status(self): pass
        def json(self): return {'data': [{'id': 'DeepSeek V4.1 Flash'}, {'id': 'Qwen3.6 35B'}, {'id': 'qwen-image-edit'}, {'id': 'bge-m3'}]}
    monkeypatch.setattr(uni.httpx, 'get', lambda *args, **kwargs: Response())
    assert uni.list_models() == [{'id': 'uni-mainz/DeepSeek V4.1 Flash', 'name': 'DeepSeek V4.1 Flash (UNI-MAINZ)'}, {'id': 'uni-mainz/Qwen3.6 35B', 'name': 'Qwen3.6 35B (UNI-MAINZ)'}]


def test_mainz_chat_tool_and_image_usage(monkeypatch):
    monkeypatch.setenv('UNI_MAINZ_API_KEY', 'test-only')
    class Connection:
        def __init__(self): self.sql = []
        def execute(self, query, *args): self.sql.append(query)
        def commit(self): self.sql.append('commit')
    sent = []
    class Client:
        def __init__(self, **kwargs): self.chat = SimpleNamespace(completions=self)
        def __enter__(self): return self
        def __exit__(self, *args): pass
        def create(self, **kwargs):
            sent.append(kwargs)
            msg = SimpleNamespace(content='source clue', tool_calls=[SimpleNamespace(type='function', function=SimpleNamespace(name='classify_nace', arguments=json.dumps({'category':'G', 'explanation':'Retail', 'evidence':['shop'], 'uncertainty':'', 'confidence':0.8})))])
            return SimpleNamespace(model='Qwen3.6 35B', choices=[SimpleNamespace(message=msg)], usage=SimpleNamespace(prompt_tokens=10, completion_tokens=5))
    monkeypatch.setattr(uni, 'OpenAI', Client)
    conn = Connection()
    content = [{'type':'input_text','text':'shop'}, {'type':'input_image','image_url':'data:image/png;base64,YWJj'}]
    response, prediction = uni.chat_call(conn, 'uni-mainz/Qwen3.6 35B', 'VERBALIZED_CONFIDENCE_V1', content)
    assert prediction.category == 'G' and prediction.confidence == 0.8
    assert response.usage.input_tokens == 10 and response.usage.output_tokens == 5
    assert sent[0]['model'] == 'Qwen3.6 35B' and sent[0]['messages'][1]['content'][1]['image_url']['url'].startswith('data:image/png;base64,')
    assert sent[0]['tool_choice']['function']['name'] == 'classify_nace'
    assert conn.sql == ['SELECT pg_advisory_xact_lock(%s, %s)', 'SELECT pg_sleep(1)', 'commit']
    _, clue = uni.chat_call(conn, 'uni-mainz/Qwen3.6 35B', 'clue', content, clue=True)
    assert clue == 'source clue' and 'tools' not in sent[1]


def test_mainz_missing_key_is_explicit(monkeypatch):
    monkeypatch.delenv('UNI_MAINZ_API_KEY', raising=False)
    assert uni.list_models() == []
    with pytest.raises(HTTPException) as error:
        uni.chat_call(None, 'uni-mainz/model', '', [])
    assert error.value.status_code == 503
