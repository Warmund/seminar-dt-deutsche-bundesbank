"""Persisted, immutable experiments; each item is claimed before any paid request."""
import os
import json
import uuid
from collections import defaultdict
from hashlib import sha256
from typing import Annotated, Literal

from fastapi import Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, model_validator
from psycopg.types.json import Jsonb

from source_text import VERSION as TEXT_PREPROCESSING_VERSION
from main import app, Connection
from auth import current_user, origin_check
from moneta_pipeline import build_prompts, source_texts, next_step, ASSETS
from classification_api import ClassificationInput, Sources, execute_classification, MODELS


class RecordKey(BaseModel):
    model_config = ConfigDict(extra='forbid')
    osm_type: str = Field(pattern='^(node|way|relation)$')
    osm_id: int = Field(gt=0, le=9223372036854775807)


class DatasetSelection(BaseModel):
    model_config = ConfigDict(extra='forbid')
    count: int = Field(ge=1, strict=True)
    seed: int = Field(default=42, ge=0, le=2147483647, strict=True)
    classes: list[Annotated[str, Field(pattern='^[A-U]$')]] = Field(min_length=1, max_length=21)

    @model_validator(mode='after')
    def unique_classes(self):
        if len(set(self.classes)) != len(self.classes):
            raise ValueError('Klassen dürfen nicht doppelt ausgewählt werden.')
        return self


class NewRun(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)
    dataset_id: int = Field(default=1,ge=1)
    model: str | None = Field(default=None, max_length=300)
    method: Literal['zero_shot', 'multi_turn'] = 'zero_shot'
    prompt_config: Literal['Simple', 'Extended'] = 'Simple'
    name: str = Field(min_length=1, max_length=150)
    sources: Sources
    selection: DatasetSelection | None = None
    items: list[RecordKey] | None = Field(default=None, min_length=1, max_length=1000)

    @model_validator(mode='after')
    def one_selection(self):
        if (self.selection is None) == (self.items is None):
            raise ValueError('Genau eine Datenauswahl ist erforderlich.')
        return self


def owned_run(connection, run_id, user):
    row = connection.execute('SELECT * FROM classification_runs WHERE id=%s AND user_id=%s', (run_id, user['id'])).fetchone()
    if not row:
        raise HTTPException(404, 'Lauf nicht gefunden.')
    return row


@app.get('/api/classification/dataset', dependencies=[Depends(current_user)])
def dataset(connection: Connection, dataset_id: Annotated[int, Query(ge=1)] = 1):
    rows = connection.execute('SELECT category,count(*) AS count FROM moneta_records WHERE dataset_id=%s GROUP BY category',(dataset_id,)).fetchall()
    counts = {row['category']:row['count'] for row in rows}
    return {'total':sum(counts.values()), 'classes':[{'category':entry['category'],'title':entry['title'],'count':counts.get(entry['category'],0)} for entry in ASSETS['sections']]}


def record_key(row):
    return f"{row['osm_type']}:{row['osm_id']}:{row['category']}"


def population_hash(keys):
    return sha256('\n'.join(sorted(keys)).encode()).hexdigest()


def stratified_sample(population, count, seed):
    groups = defaultdict(list)
    for row in population:
        groups[row['category']].append(row)

    # Allocate whole places first, then distribute the remainder by fractional quota.
    quotas, remainders = {}, {}
    for category, group in groups.items():
        quotas[category], remainders[category] = divmod(count * len(group), len(population))
    remaining = count - sum(quotas.values())
    for category in sorted(groups, key=lambda category: (-remainders[category], category))[:remaining]:
        quotas[category] += 1

    def rank(row):
        return sha256(f'{seed}:{record_key(row)}'.encode()).digest()

    selected = []
    for category in sorted(groups):
        selected.extend(sorted(groups[category], key=rank)[:quotas[category]])
    return selected


@app.post('/api/classification/runs', status_code=201, dependencies=[Depends(origin_check)])
def create_run(data: NewRun, connection: Connection, user=Depends(current_user)):
    if data.model and (data.model.startswith('jev-') or data.model == 'perplexity/pplx-decider-v1.2') and data.method != 'zero_shot':
        raise HTTPException(422,'Das Entscheidungsmodell unterstützt keine MONETA-Hinweisextraktion. Bitte Zero-Shot auswählen.')
    if data.method == 'multi_turn' and not all(data.sources.model_dump().values()):
        raise HTTPException(422, 'Multi-Turn verwendet alle verfügbaren Quellen wie MONETA.')
    if data.selection:
        population = connection.execute(
            'SELECT osm_type,osm_id,category FROM moneta_records WHERE dataset_id=%s AND category = ANY(%s)',
            (data.dataset_id, data.selection.classes),
        ).fetchall()
        if data.selection.count > len(population):
            raise HTTPException(422, f'Für die gewählten Klassen sind nur {len(population)} Datenpunkte verfügbar. Bitte die Anzahl reduzieren.')
        sample = stratified_sample(population, data.selection.count, data.selection.seed)
        rows = connection.execute(
            'SELECT r.osm_type,r.osm_id,r.name,r.category,r.data FROM moneta_records r '
            'JOIN unnest(%s::text[],%s::bigint[],%s::text[]) AS s(osm_type,osm_id,category) '
            'USING (osm_type,osm_id,category) WHERE r.dataset_id=%s ORDER BY r.osm_type,r.osm_id',
            ([row['osm_type'] for row in sample], [row['osm_id'] for row in sample],
             [row['category'] for row in sample], data.dataset_id),
        ).fetchall()
        if len(rows) != data.selection.count:
            raise HTTPException(409, 'Der Datensatz wurde während der Auswahl geändert. Bitte erneut versuchen.')
        criteria = {
            **data.selection.model_dump(),
            'strategy': 'stratified-v1',
            'population_count': len(population),
            'population_hash': population_hash(map(record_key, population)),
        }
    else:
        keys = {(item.osm_type,item.osm_id) for item in data.items}
        if len(keys) != len(data.items):
            raise HTTPException(422,'Doppelte Unternehmen in der Auswahl.')
        rows = []
        for item in data.items:
            row = connection.execute('SELECT osm_type,osm_id,name,category,data FROM moneta_records WHERE dataset_id=%s AND osm_type=%s AND osm_id=%s',(data.dataset_id,item.osm_type,item.osm_id)).fetchone()
            if not row:
                raise HTTPException(422,'Ein ausgewähltes Unternehmen ist nicht mehr vorhanden.')
            rows.append(row)
        criteria = {}
    selected_dataset=connection.execute('SELECT id,name FROM moneta_datasets WHERE id=%s',(data.dataset_id,)).fetchone()
    if not selected_dataset:raise HTTPException(404,'Datensatz nicht gefunden.')
    criteria.update(dataset_id=data.dataset_id,dataset_name=selected_dataset['name'])
    model = data.model or os.environ.get('OPENAI_MODEL','gpt-6-luna')
    if (model.startswith('jev-') or model == 'perplexity/pplx-decider-v1.2') and data.method != 'zero_shot':
        raise HTTPException(422,'Das Entscheidungsmodell unterstützt nur das direkte Verfahren.')
    if model.startswith('uni-mainz/'):
        from uni_mainz import list_models
        if model not in {item['id'] for item in list_models()}:
            raise HTTPException(422,'Bitte ein verfügbares Uni-Mainz-Modell auswählen.')
    elif model not in MODELS:
        raise HTTPException(422,'Bitte ein unterstütztes Modell auswählen.')
    run_id = uuid.uuid4()
    if (model.startswith('jev-') or model == 'perplexity/pplx-decider-v1.2'):
        from jev_api import build_questions
        prompt, clue_prompts = json.dumps(build_questions(data.prompt_config)), {}
    else:
        prompt, clue_prompts = build_prompts(data.method,data.prompt_config,data.sources.model_dump())
        prompt += '\nVERBALIZED_CONFIDENCE_V1: Provide confidence as your own estimated probability between 0 and 1 that your selected NACE category is correct. Do not report confidence in the quality of explanation. Express uncertainty honestly.'
    connection.execute('INSERT INTO classification_runs (id,user_id,name,model,prompt,sources,method,prompt_config,clue_prompts,selection,dataset_id) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)',
                       (run_id,user['id'],data.name,model,prompt,Jsonb(data.sources.model_dump()),data.method,data.prompt_config,Jsonb(clue_prompts),Jsonb(criteria),data.dataset_id))
    kinds = [kind for kind in ('osm','satellite') if getattr(data.sources,kind)]
    images_by_record = {}
    if kinds:
        images = connection.execute(
            'SELECT osm_type,osm_id,kind,object_key FROM moneta_images WHERE dataset_id=%s AND kind = ANY(%s) '
            'AND (osm_type,osm_id) IN (SELECT * FROM unnest(%s::text[],%s::bigint[]))',
            (data.dataset_id,kinds,[row['osm_type'] for row in rows],[row['osm_id'] for row in rows])).fetchall()
        for image in images:
            if not image['object_key']:
                raise HTTPException(409,'Bitte zuerst die alten Datenbankbilder in den Object Storage migrieren.')
            images_by_record.setdefault((image['osm_type'],image['osm_id']),{})[image['kind']] = {'object_key':image['object_key']}
    inserts = []
    for position, row in enumerate(rows):
        snapshot = {'tags':row['data'].get('tags') or row['data'].get('osm_tags') or {}, 'texts':source_texts(row['data'],for_jev=(model.startswith('jev-') or model == 'perplexity/pplx-decider-v1.2')) if data.sources.text else {},
                    'images':images_by_record.get((row['osm_type'],row['osm_id']),{})}
        if (model.startswith('jev-') or model == 'perplexity/pplx-decider-v1.2'):
            snapshot['text_preprocessing'] = TEXT_PREPROCESSING_VERSION
        inserts.append((run_id,position,row['osm_type'],str(row['osm_id']),row['name'],row['category'],Jsonb(snapshot)))
    with connection.cursor() as cursor:
        cursor.executemany('INSERT INTO classification_run_items (run_id,position,osm_type,osm_id,name,reference,snapshot) VALUES (%s,%s,%s,%s,%s,%s,%s)',inserts)
    return {'id':str(run_id)}


@app.get('/api/classification/runs')
def list_runs(connection: Connection, user=Depends(current_user), offset: Annotated[int, Query(ge=0)] = 0):
    rows = connection.execute('SELECT r.id,r.name,r.model,r.sources,r.method,r.prompt_config,r.created_at,r.runner_state, count(*) AS total, '
        "count(*) FILTER (WHERE i.state='done') AS done, count(*) FILTER (WHERE i.state='error') AS errors, "
        "count(*) FILTER (WHERE i.state='running') AS running FROM classification_runs r JOIN classification_run_items i ON i.run_id=r.id "
        'WHERE r.user_id=%s GROUP BY r.id ORDER BY r.created_at DESC LIMIT 25 OFFSET %s', (user['id'],offset)).fetchall()
    total = connection.execute('SELECT count(*) AS n FROM classification_runs WHERE user_id=%s',(user['id'],)).fetchone()['n']
    return {'items':rows, 'total':total}


@app.get('/api/classification/runs/{run_id}')
def get_run(run_id: uuid.UUID, connection: Connection, user=Depends(current_user)):
    run = owned_run(connection, run_id, user)
    items = connection.execute('SELECT position,osm_type,osm_id,name,reference,state,result,clues,error,started_at,finished_at, '
        "(state='running' AND started_at < now() - interval '5 minutes') AS stalled FROM classification_run_items WHERE run_id=%s ORDER BY position",(run_id,)).fetchall()
    return {**run, 'items':items, 'sample_comparison': sample_comparison(connection, run, items)}


def sample_comparison(connection, run, items):
    selection = run['selection']
    population_count = selection.get('population_count')
    if not population_count or len(items) >= population_count:
        return None

    def prediction(item):
        if item['state'] == 'done' and item['result']:
            return item['result'].get('prediction', {}).get('category')
        return None

    predictions = [prediction(item) for item in items]
    if any(value is None for value in predictions):
        return {'status': 'sample_incomplete'}

    # Match the original population, so later imports cannot silently change the benchmark.
    candidates = connection.execute(
        """
        SELECT r.id,r.name,
            array_agg(i.osm_type || ':' || i.osm_id || ':' || i.reference) AS keys,
            count(*) FILTER (WHERE (i.result #>> '{prediction,category}') = i.reference) AS correct
        FROM classification_runs r JOIN classification_run_items i ON i.run_id=r.id
        WHERE r.user_id=%s AND r.dataset_id=%s AND r.model=%s AND r.method=%s
            AND r.prompt_config=%s AND r.prompt=%s AND r.clue_prompts=%s AND r.sources=%s
        GROUP BY r.id
        HAVING count(*)=%s
            AND count(*) FILTER (WHERE i.state='done' AND (i.result #>> '{prediction,category}') IS NOT NULL)=%s
        ORDER BY r.created_at DESC,r.id
        """,
        (run['user_id'], run['dataset_id'], run['model'], run['method'], run['prompt_config'],
         run['prompt'], Jsonb(run['clue_prompts']), Jsonb(run['sources']), population_count, population_count),
    )
    for candidate in candidates:
        if population_hash(candidate['keys']) == selection['population_hash']:
            sample_accuracy = sum(value == item['reference'] for value, item in zip(predictions, items)) / len(items)
            population_accuracy = candidate['correct'] / population_count
            return {
                'status': 'available',
                'run_id': candidate['id'],
                'run_name': candidate['name'],
                'sample_accuracy': sample_accuracy,
                'population_accuracy': population_accuracy,
                'difference_pp': (sample_accuracy - population_accuracy) * 100,
            }
    return {'status': 'population_run_missing'}


class StartRun(BaseModel):
    model_config = ConfigDict(extra='forbid')
    retry_position: int | None = Field(default=None, ge=0)


@app.post('/api/classification/runs/{run_id}/start', dependencies=[Depends(origin_check)])
def start_background(run_id: uuid.UUID, data: StartRun, connection: Connection, user=Depends(current_user)):
    from run_queue import publish_step
    run = connection.execute('SELECT runner_state FROM classification_runs WHERE id=%s AND user_id=%s FOR UPDATE', (run_id,user['id'])).fetchone()
    if not run:
        raise HTTPException(404, 'Lauf nicht gefunden.')
    if run['runner_state'] == 'running':
        raise HTTPException(409, 'Lauf wird bereits verarbeitet.')
    if connection.execute("SELECT 1 FROM classification_run_items WHERE run_id=%s AND state='running' AND started_at > now() - interval '5 minutes'", (run_id,)).fetchone():
        raise HTTPException(409, 'Eine Anfrage wird noch verarbeitet. Bitte kurz warten.')
    if data.retry_position is None:
        item = connection.execute("SELECT position,clues,state,attempt FROM classification_run_items WHERE run_id=%s AND state='pending' ORDER BY position LIMIT 1", (run_id,)).fetchone()
    else:
        item = connection.execute("SELECT position,clues,state,attempt FROM classification_run_items WHERE run_id=%s AND position=%s AND state IN ('error','running')", (run_id,data.retry_position)).fetchone()
    if not item:
        raise HTTPException(409, 'Kein passender offener Schritt gefunden.')
    generation = uuid.uuid4()
    connection.execute("UPDATE classification_runs SET runner_state='running', runner_generation=%s WHERE id=%s", (generation,run_id))
    try:
        publish_step(run_id,user['id'],generation,item['position'],len(item['clues'] or {}),retry=data.retry_position is not None,single=data.retry_position is not None,previous_attempt=item['attempt'])
    except Exception:
        connection.rollback()
        raise HTTPException(503, 'Hintergrundverarbeitung konnte nicht gestartet werden. Bitte erneut versuchen.') from None
    connection.commit()
    return {'ok': True}


@app.post('/api/classification/runs/{run_id}/stop', dependencies=[Depends(origin_check)])
def stop_background(run_id: uuid.UUID, connection: Connection, user=Depends(current_user)):
    run = connection.execute("UPDATE classification_runs SET runner_state='paused' WHERE id=%s AND user_id=%s RETURNING id", (run_id,user['id'])).fetchone()
    if not run:
        raise HTTPException(404, 'Lauf nicht gefunden.')
    return {'ok': True}


@app.delete('/api/classification/runs/{run_id}', dependencies=[Depends(origin_check)])
def delete_run(run_id: uuid.UUID, connection: Connection, user=Depends(current_user)):
    run = connection.execute('SELECT id,runner_state FROM classification_runs WHERE id=%s AND user_id=%s FOR UPDATE', (run_id,user['id'])).fetchone()
    if not run:
        raise HTTPException(404, 'Lauf nicht gefunden.')
    if run.get('runner_state') == 'running':
        raise HTTPException(409, 'Bitte den Lauf zuerst stoppen.')
    if connection.execute("SELECT 1 FROM classification_run_items WHERE run_id=%s AND state='running'", (run_id,)).fetchone():
        raise HTTPException(409, 'Lauf wird noch verarbeitet oder ist unterbrochen. Bitte zuerst den laufenden Schritt abschließen oder erneut versuchen.')
    connection.execute('DELETE FROM classification_runs WHERE id=%s AND user_id=%s', (run_id,user['id']))
    return {'ok': True}


@app.post('/api/classification/runs/{run_id}/items/{position}', dependencies=[Depends(origin_check)])
def process_item(run_id: uuid.UUID, position: int, connection: Connection, user=Depends(current_user), retry: bool = False, generation: uuid.UUID | None = None):
    run = owned_run(connection, run_id, user)
    # Lock the run to allow only one paid request at a time, including across browser tabs.
    locked = connection.execute('SELECT id,runner_state,runner_generation FROM classification_runs WHERE id=%s FOR UPDATE', (run_id,)).fetchone()
    if not locked:
        raise HTTPException(404, 'Lauf nicht gefunden.')
    if generation is not None and (locked['runner_state'] != 'running' or locked['runner_generation'] != generation):
        raise HTTPException(409, 'Lauf wurde angehalten.')
    item = connection.execute('SELECT * FROM classification_run_items WHERE run_id=%s AND position=%s', (run_id,position)).fetchone()
    if not item:
        raise HTTPException(404,'Datenpunkt im Lauf nicht gefunden.')
    if item['state'] == 'done':
        return item['result']
    busy = connection.execute("SELECT 1 FROM classification_run_items WHERE run_id=%s AND state='running' AND started_at > now() - interval '5 minutes'", (run_id,)).fetchone()
    if busy:
        raise HTTPException(409,'In diesem Lauf wird bereits eine Anfrage verarbeitet.')
    if item['state'] in ('error','running') and not retry:
        raise HTTPException(409,'Erneuter Versuch muss ausdrücklich gestartet werden; dabei können erneut Kosten entstehen.')
    attempt = uuid.uuid4()
    connection.execute("UPDATE classification_run_items SET state='running',started_at=now(),finished_at=NULL,error=NULL,attempt=%s WHERE run_id=%s AND position=%s", (attempt,run_id,position))
    connection.commit()
    try:
        if (run['model'].startswith('jev-') or run['model'] == 'perplexity/pplx-decider-v1.2'):
            from jev_api import classify_jev
            result, clues = classify_jev(run,item,connection,user), {}
        elif run['method'] == 'legacy':
            result = execute_classification(ClassificationInput(osm_type=item['osm_type'],osm_id=int(item['osm_id']),sources=Sources(**run['sources'])), connection,user,
            row={'name':item['name'],'category':item['reference'],'data':{},'input_features':item['snapshot']['data']['tags']}, images=item['snapshot']['images'], model=run['model'], prompt=run['prompt'])
            clues = {}
        else:
            result, clues = next_step(run,item,connection,user)
    except Exception as exc:
        connection.rollback()
        message = exc.detail if isinstance(exc,HTTPException) and isinstance(exc.detail,str) else 'Verarbeitung fehlgeschlagen. Kein automatischer Neuversuch.'
        connection.execute("UPDATE classification_run_items SET state='error',error=%s,finished_at=now() WHERE run_id=%s AND position=%s AND attempt=%s", (message,run_id,position,attempt))
        connection.commit()
        raise HTTPException(exc.status_code if isinstance(exc,HTTPException) else 503,message) from None
    connection.execute("UPDATE classification_run_items SET state=%s,result=%s,clues=%s,finished_at=CASE WHEN %s THEN now() ELSE NULL END WHERE run_id=%s AND position=%s AND attempt=%s", ('done' if result else 'pending',Jsonb(result) if result else None,Jsonb(clues),bool(result),run_id,position,attempt))
    connection.commit()
    return result or {'step_completed':True,'clue_count':len(clues)}
