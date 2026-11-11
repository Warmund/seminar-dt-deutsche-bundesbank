"""Persisted, immutable experiments; each item is claimed before any paid request."""
import os
import uuid
from typing import Annotated

from fastapi import Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field
from psycopg.types.json import Jsonb

from main import app, Connection
from auth import current_user, origin_check
from classification_api import ClassificationInput, Sources, PROMPT, text_features, execute_classification


class RecordKey(BaseModel):
    model_config = ConfigDict(extra='forbid')
    osm_type: str = Field(pattern='^(node|way|relation)$')
    osm_id: int = Field(gt=0, le=9223372036854775807)


class NewRun(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)
    name: str = Field(min_length=1, max_length=150)
    sources: Sources
    items: list[RecordKey] = Field(min_length=1, max_length=1000)


def owned_run(connection, run_id, user):
    row = connection.execute('SELECT * FROM classification_runs WHERE id=%s AND user_id=%s', (run_id, user['id'])).fetchone()
    if not row:
        raise HTTPException(404, 'Lauf nicht gefunden.')
    return row


@app.post('/api/classification/runs', status_code=201, dependencies=[Depends(origin_check)])
def create_run(data: NewRun, connection: Connection, user=Depends(current_user)):
    if not any(data.sources.model_dump().values()):
        raise HTTPException(422, 'Bitte mindestens eine Quelle auswählen.')
    keys = {(item.osm_type, item.osm_id) for item in data.items}
    if len(keys) != len(data.items):
        raise HTTPException(422, 'Doppelte Unternehmen in der Auswahl.')
    run_id = uuid.uuid4()
    connection.execute('INSERT INTO classification_runs (id,user_id,name,model,prompt,sources) VALUES (%s,%s,%s,%s,%s,%s)',
                       (run_id,user['id'],data.name,os.environ.get('OPENAI_MODEL','gpt-6-luna'),PROMPT,Jsonb(data.sources.model_dump())))
    for position, item in enumerate(data.items):
        row = connection.execute('SELECT name, category, data FROM moneta_records WHERE osm_type=%s AND osm_id=%s', (item.osm_type,item.osm_id)).fetchone()
        if not row:
            raise HTTPException(422, 'Ein ausgewähltes Unternehmen ist nicht mehr vorhanden.')
        features = text_features(row['data']) if data.sources.text else {}
        images = {}
        for kind in ('osm','satellite'):
            if getattr(data.sources,kind):
                image = connection.execute('SELECT object_key FROM moneta_images WHERE osm_type=%s AND osm_id=%s AND kind=%s', (item.osm_type,item.osm_id,kind)).fetchone()
                if image:
                    if not image['object_key']:
                        raise HTTPException(409, 'Bitte zuerst die alten Datenbankbilder in den Object Storage migrieren.')
                    images[kind] = {'object_key':image['object_key']}
        snapshot = {'data': {'tags':features}, 'images':images}
        connection.execute('INSERT INTO classification_run_items (run_id,position,osm_type,osm_id,name,reference,snapshot) VALUES (%s,%s,%s,%s,%s,%s,%s)',
                           (run_id,position,item.osm_type,str(item.osm_id),row['name'],row['category'],Jsonb(snapshot)))
    return {'id':str(run_id)}


@app.get('/api/classification/runs')
def list_runs(connection: Connection, user=Depends(current_user), offset: Annotated[int, Query(ge=0)] = 0):
    rows = connection.execute('SELECT r.id,r.name,r.model,r.sources,r.created_at, count(*) AS total, '
        "count(*) FILTER (WHERE i.state='done') AS done, count(*) FILTER (WHERE i.state='error') AS errors, "
        "count(*) FILTER (WHERE i.state='running') AS running FROM classification_runs r JOIN classification_run_items i ON i.run_id=r.id "
        'WHERE r.user_id=%s GROUP BY r.id ORDER BY r.created_at DESC LIMIT 25 OFFSET %s', (user['id'],offset)).fetchall()
    total = connection.execute('SELECT count(*) AS n FROM classification_runs WHERE user_id=%s',(user['id'],)).fetchone()['n']
    return {'items':rows, 'total':total}


@app.get('/api/classification/runs/{run_id}')
def get_run(run_id: uuid.UUID, connection: Connection, user=Depends(current_user)):
    run = owned_run(connection, run_id, user)
    items = connection.execute('SELECT position,osm_type,osm_id,name,reference,state,result,error,started_at,finished_at, '
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
        result = execute_classification(ClassificationInput(osm_type=item['osm_type'],osm_id=int(item['osm_id']),sources=Sources(**run['sources'])), connection,user,
            row={'name':item['name'],'category':item['reference'],'data':{},'input_features':item['snapshot']['data']['tags']}, images=item['snapshot']['images'], model=run['model'], prompt=run['prompt'])
    except Exception as exc:
        connection.rollback()
        message = exc.detail if isinstance(exc,HTTPException) and isinstance(exc.detail,str) else 'Verarbeitung fehlgeschlagen. Kein automatischer Neuversuch.'
        connection.execute("UPDATE classification_run_items SET state='error',error=%s,finished_at=now() WHERE run_id=%s AND position=%s AND attempt=%s", (message,run_id,position,attempt))
        connection.commit()
        raise HTTPException(exc.status_code if isinstance(exc,HTTPException) else 503,message) from None
    connection.execute("UPDATE classification_run_items SET state='done',result=%s,finished_at=now() WHERE run_id=%s AND position=%s AND attempt=%s", (Jsonb(result),run_id,position,attempt))
    connection.commit()
    return result
