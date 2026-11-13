"""University of Mainz OpenAI-compatible chat adapter."""
import base64
import os
from types import SimpleNamespace

import httpx
from fastapi import HTTPException
from openai import OpenAI, OpenAIError, RateLimitError, APITimeoutError
from pydantic import ValidationError

BASE_URL = 'https://ki-chat.uni-mainz.de/api'
PREFIX = 'uni-mainz/'


def list_models():
    key = os.environ.get('UNI_MAINZ_API_KEY')
    if not key:
        return []
    try:
        response = httpx.get(BASE_URL + '/models', headers={'Authorization': 'Bearer ' + key}, timeout=10)
        response.raise_for_status()
        items = response.json()['data']
        models = []
        for item in items:
            model_id = item.get('id')
            name = item.get('name') or model_id
            if not isinstance(model_id, str) or not isinstance(name, str):
                continue
            description = (model_id + ' ' + name).lower()
            if any(family in description for family in ('deepseek', 'qwen')) and not any(kind in description for kind in ('embedding', 'embed', 'image-edit', 'qwen-image', 'rerank')):
                models.append({'id': PREFIX + model_id, 'name': name + ' (UNI-MAINZ)'})
        return models
    except (httpx.HTTPError, ValueError, KeyError, TypeError, AttributeError):
        raise HTTPException(503, 'Modelle der Uni Mainz konnten nicht geladen werden. API-Key und Erreichbarkeit prüfen.') from None


def chat_call(connection, model, prompt, content, clue=False):
    from classification_api import Prediction, ConfidencePrediction
    key = os.environ.get('UNI_MAINZ_API_KEY')
    if not key:
        raise HTTPException(503, 'Uni-Mainz-API-Key fehlt im Backend.')
    parts = []
    try:
        for part in content:
            if part['type'] == 'input_text':
                parts.append({'type': 'text', 'text': part['text']})
            elif part['type'] == 'input_image':
                url = part['image_url']
                if not url.startswith('data:'):
                    with httpx.stream('GET', url, timeout=30, follow_redirects=False) as response:
                        response.raise_for_status()
                        image = b''
                        for chunk in response.iter_bytes():
                            image += chunk
                            if len(image) > 3_000_000:
                                raise HTTPException(422, 'Bild überschreitet 3 MB.')
                    url = 'data:image/png;base64,' + base64.b64encode(image).decode()
                parts.append({'type': 'image_url', 'image_url': {'url': url}})
        schema = ConfidencePrediction if 'VERBALIZED_CONFIDENCE_V1' in prompt else Prediction
        options = {'model': model[len(PREFIX):], 'messages': [{'role': 'system', 'content': prompt}, {'role': 'user', 'content': parts}], 'max_tokens': 4000}
        if not clue:
            options['tools'] = [{'type': 'function', 'function': {'name': 'classify_nace', 'description': 'Return the NACE classification.', 'parameters': schema.model_json_schema()}}]
            options['tool_choice'] = {'type': 'function', 'function': {'name': 'classify_nace'}}
        # Serialize university calls across server instances, with a one-second gap.
        connection.execute('SELECT pg_advisory_xact_lock(%s, %s)', (1431193933, 1))
        try:
            with OpenAI(api_key=key, base_url=BASE_URL, timeout=90, max_retries=0) as client:
                response = client.chat.completions.create(**options)
        finally:
            try:
                connection.execute('SELECT pg_sleep(1)')
            finally:
                connection.commit()
        message = response.choices[0].message
        if clue:
            if not message.content:
                raise ValueError('missing clue')
            result = message.content
        else:
            calls = message.tool_calls or []
            call = next((call for call in calls if call.type == 'function' and call.function.name == 'classify_nace'), None)
            if not call:
                raise ValueError('missing classification')
            result = schema.model_validate_json(call.function.arguments)
        usage = response.usage
        wrapped = SimpleNamespace(model=PREFIX + response.model, usage=SimpleNamespace(input_tokens=usage.prompt_tokens, output_tokens=usage.completion_tokens) if usage else None)
        return wrapped, result
    except RateLimitError:
        raise HTTPException(503, 'Uni Mainz: Anfragelimit erreicht. Bitte später erneut versuchen.') from None
    except (APITimeoutError, httpx.TimeoutException):
        raise HTTPException(504, 'Uni Mainz hat nicht rechtzeitig geantwortet. Kein automatischer Neuversuch.') from None
    except (OpenAIError, httpx.HTTPError, ValueError, ValidationError, IndexError, KeyError, TypeError):
        raise HTTPException(502, 'Uni-Mainz-Anfrage fehlgeschlagen. Modellzugriff und Antwortformat prüfen.') from None
