"""Persisted, immutable experiments; each item is claimed before any paid request."""
import os
import json
import uuid
from typing import Annotated, Literal

from fastapi import Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, model_validator
from psycopg.types.json import Jsonb

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
    count: int = Field(ge=1, le=1000, strict=True)
    classes: list[Annotated[str, Field(pattern='^[A-U]$')]] = Field(min_length=1, max_length=21)

    @model_validator(mode='after')
    def unique_classes(self):
        if len(set(self.classes)) != len(self.classes):
            raise ValueError('Klassen dürfen nicht doppelt ausgewählt werden.')
        return self


class NewRun(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)
    model: Literal['gpt-6-luna', 'gpt-6.1-terra', 'jev-1.13', 'jev-1.13-free'] | None = None
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
def dataset(connection: Connection):
    rows = connection.execute('SELECT category,count(*) AS count FROM moneta_records GROUP BY category').fetchall()
    counts = {row['category']:row['count'] for row in rows}
    return {'total':sum(counts.values()), 'classes':[{'category':entry['category'],'title':entry['title'],'count':counts.get(entry['category'],0)} for entry in ASSETS['sections']]}


@app.post('/api/classification/runs', status_code=201, dependencies=[Depends(origin_check)])
def create_run(data: NewRun, connection: Connection, user=Depends(current_user)):
    if data.model and data.model.startswith('jev-') and data.method != 'zero_shot':
        raise HTTPException(422,'Jev unterstützt keine MONETA-Hinweisextraktion. Bitte Zero-Shot auswählen.')
    if data.method == 'multi_turn' and not all(data.sources.model_dump().values()):
        raise HTTPException(422, 'Multi-Turn verwendet alle verfügbaren Quellen wie MONETA.')
    if data.selection:
        rows = connection.execute('SELECT osm_type,osm_id,name,category,data FROM moneta_records WHERE category = ANY(%s) ORDER BY osm_type,osm_id LIMIT %s',
                                  (data.selection.classes,data.selection.count)).fetchall()
        if len(rows) != data.selection.count:
            raise HTTPException(422, f'Für die gewählten Klassen sind nur {len(rows)} Datenpunkte verfügbar. Bitte die Anzahl reduzieren.')
        criteria = {**data.selection.model_dump(), 'order':'osm_type,osm_id'}
    else:
        keys = {(item.osm_type,item.osm_id) for item in data.items}
        if len(keys) != len(data.items):
            raise HTTPException(422,'Doppelte Unternehmen in der Auswahl.')
        rows = []
        for item in data.items:
            row = connection.execute('SELECT osm_type,osm_id,name,category,data FROM moneta_records WHERE osm_type=%s AND osm_id=%s',(item.osm_type,item.osm_id)).fetchone()
            if not row:
                raise HTTPException(422,'Ein ausgewähltes Unternehmen ist nicht mehr vorhanden.')
            rows.append(row)
        criteria = {}
    model = data.model or os.environ.get('OPENAI_MODEL','gpt-6-luna')
    if model.startswith('jev-') and data.method != 'zero_shot':
        raise HTTPException(422,'Jev unterstützt nur das direkte Verfahren.')
    if model not in MODELS:
        raise HTTPException(422,'Bitte ein unterstütztes Modell auswählen.')
    run_id = uuid.uuid4()
    if model.startswith('jev-'):
        from jev_api import build_questions
        prompt, clue_prompts = json.dumps(build_questions(data.prompt_config)), {}
    else:
        prompt, clue_prompts = build_prompts(data.method,data.prompt_config,data.sources.model_dump())
    connection.execute('INSERT INTO classification_runs (id,user_id,name,model,prompt,sources,method,prompt_config,clue_prompts,selection) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)',
                       (run_id,user['id'],data.name,model,prompt,Jsonb(data.sources.model_dump()),data.method,data.prompt_config,Jsonb(clue_prompts),Jsonb(criteria)))
    kinds = [kind for kind in ('osm','satellite') if getattr(data.sources,kind)]
    images_by_record = {}
    if kinds:
        images = connection.execute(
            'SELECT osm_type,osm_id,kind,object_key FROM moneta_images WHERE kind = ANY(%s) '
            'AND (osm_type,osm_id) IN (SELECT * FROM unnest(%s::text[],%s::bigint[]))',
            (kinds,[row['osm_type'] for row in rows],[row['osm_id'] for row in rows])).fetchall()
        for image in images:
            if not image['object_key']:
                raise HTTPException(409,'Bitte zuerst die alten Datenbankbilder in den Object Storage migrieren.')
            images_by_record.setdefault((image['osm_type'],image['osm_id']),{})[image['kind']] = {'object_key':image['object_key']}
    inserts = []
    for position, row in enumerate(rows):
        snapshot = {'texts':source_texts(row['data']) if data.sources.text else {},
                    'images':images_by_record.get((row['osm_type'],row['osm_id']),{})}
        inserts.append((run_id,position,row['osm_type'],str(row['osm_id']),row['name'],row['category'],Jsonb(snapshot)))
    with connection.cursor() as cursor:
        cursor.executemany('INSERT INTO classification_run_items (run_id,position,osm_type,osm_id,name,reference,snapshot) VALUES (%s,%s,%s,%s,%s,%s,%s)',inserts)
    return {'id':str(run_id)}


@app.get('/api/classification/runs')
def list_runs(connection: Connection, user=Depends(current_user), offset: Annotated[int, Query(ge=0)] = 0):
    rows = connection.execute('SELECT r.id,r.name,r.model,r.sources,r.method,r.prompt_config,r.created_at, count(*) AS total, '
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
    return {**run, 'items':items}


@app.post('/api/classification/runs/{run_id}/items/{position}', dependencies=[Depends(origin_check)])
def process_item(run_id: uuid.UUID, position: int, connection: Connection, user=Depends(current_user), retry: bool = False):
    run = owned_run(connection, run_id, user)
    # Lock the run to allow only one paid request at a time, including across browser tabs.
    connection.execute('SELECT id FROM classification_runs WHERE id=%s FOR UPDATE', (run_id,))
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
        if run['model'].startswith('jev-'):
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
