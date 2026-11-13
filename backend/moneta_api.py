"""Authenticated MONETA import; each request commits independently and is retryable."""
import json
from io import BytesIO
from typing import Annotated, Literal

from botocore.exceptions import BotoCoreError, ClientError
from starlette.responses import RedirectResponse
import image_storage

from fastapi import Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator
from psycopg.types.json import Jsonb
from PIL import Image, UnidentifiedImageError

from main import Connection, app
from auth import current_user, origin_check

LIMIT = 3_000_000
Read = [Depends(current_user)]
Write = [Depends(current_user), Depends(origin_check)]


class NewDataset(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)
    name: str = Field(min_length=1,max_length=150)

@app.get('/api/moneta/datasets', dependencies=Read)
def datasets(connection:Connection):
    return {'items':connection.execute('SELECT d.id,d.name,d.created_at,count(r.osm_id) AS total FROM moneta_datasets d LEFT JOIN moneta_records r ON r.dataset_id=d.id GROUP BY d.id ORDER BY d.id').fetchall()}

@app.post('/api/moneta/datasets', dependencies=Write, status_code=201)
def new_dataset(data:NewDataset,connection:Connection):
    row=connection.execute('INSERT INTO moneta_datasets(name) VALUES(%s) ON CONFLICT(name) DO NOTHING RETURNING id,name',(data.name,)).fetchone()
    if not row:raise HTTPException(409,'Dieser Datensatzname ist bereits vergeben. Bitte den vorhandenen Datensatz als Importziel wählen.')
    return row

def ensure_dataset(connection,dataset_id):
    if not connection.execute('SELECT 1 FROM moneta_datasets WHERE id=%s',(dataset_id,)).fetchone():raise HTTPException(404,'Datensatz nicht gefunden.')

class Record(BaseModel):
    model_config = ConfigDict(extra='allow', allow_inf_nan=False)
    id: Annotated[int, Field(strict=True, gt=0, le=9223372036854775807)]
    type: Literal['node', 'way', 'relation']
    category: Annotated[str, Field(pattern=r'^[A-U]$')]
    bbox: tuple[float, float, float, float]
    tags: dict | None = None
    osm_tags: dict | None = None
    name: str | None = None

    @model_validator(mode='after')
    def check_record(self):
        west, south, east, north = self.bbox
        if not (-180 <= west <= east <= 180 and -90 <= south <= north <= 90):
            raise ValueError('Ungültige Koordinaten')
        tags = self.tags if self.tags is not None else self.osm_tags
        if not isinstance(tags, dict) or not str(tags.get('name') or self.name or '').strip():
            raise ValueError('Name und tags oder osm_tags fehlen')
        return self


def clean_text(value):
    """Web extracts may contain NUL; PostgreSQL text/JSONB cannot store it."""
    if isinstance(value, str):
        value.encode('utf-8')  # Reject unpaired Unicode surrogates before reaching PostgreSQL.
        return value.replace('\x00', ''), value.count('\x00')
    if isinstance(value, (list, dict)):
        result = [] if isinstance(value, list) else {}
        count = 0
        entries = enumerate(value) if isinstance(value, list) else value.items()
        for key, item in entries:
            if isinstance(key, str):
                key.encode('utf-8')
                if '\x00' in key:
                    raise ValueError('Nullzeichen in JSON-Feldnamen')
            cleaned, removed = clean_text(item)
            if isinstance(result, list):
                result.append(cleaned)
            else:
                result[key] = cleaned
            count += removed
        return result, count
    return value, 0


def reject_constant(value):
    raise ValueError('Nicht endliche Zahl')


async def bounded_body(request: Request):
    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > LIMIT:
            raise HTTPException(413, 'Pro Anfrage sind höchstens 3 MB erlaubt')
    return bytes(body)


def verify_png(body: bytes):
    try:
        with Image.open(BytesIO(body)) as image:
            if image.format != 'PNG' or image.width * image.height > 16_000_000:
                raise ValueError('PNG mit höchstens 16 Millionen Pixeln erforderlich')
            image.verify()
    except (UnidentifiedImageError, OSError, ValueError, SyntaxError, EOFError, Image.DecompressionBombError) as exc:
        raise HTTPException(422, 'Ungültiges oder zu großes PNG-Bild') from exc


@app.post('/api/moneta/records', dependencies=Write)
async def import_record(request: Request, connection: Connection, dataset_id: Annotated[int,Query(ge=1)] = 1):
    ensure_dataset(connection,dataset_id)
    try:
        raw = json.loads(await bounded_body(request), parse_constant=reject_constant)
        raw, removed = clean_text(raw)
        record = Record.model_validate(raw)
    except (ValueError, ValidationError) as exc:
        raise HTTPException(422, 'Ungültiger MONETA-Datenpunkt: id, type, category, bbox und Unternehmensname prüfen') from exc
    tags = record.tags if record.tags is not None else record.osm_tags
    name = str(tags.get('name') or record.name).strip()
    connection.execute(
        'INSERT INTO moneta_records (dataset_id, osm_type, osm_id, name, category, data) VALUES (%s,%s,%s,%s,%s,%s) '
        'ON CONFLICT (dataset_id, osm_type, osm_id) DO UPDATE SET name=EXCLUDED.name, category=EXCLUDED.category, data=EXCLUDED.data, updated_at=now()',
        (dataset_id, record.type, record.id, name, record.category, Jsonb(raw)),
    )
    return {'key': f'{record.type}_{record.id}', 'removed_null_characters': removed}


@app.put('/api/moneta/records/{osm_type}/{osm_id}/images/{kind}', dependencies=Write)
async def upload_image(osm_type: Literal['node', 'way', 'relation'], osm_id: int, kind: Literal['osm', 'satellite'], request: Request, connection: Connection, dataset_id: Annotated[int,Query(ge=1)] = 1):
    body = await bounded_body(request)
    verify_png(body)
    if not connection.execute('SELECT 1 FROM moneta_records WHERE dataset_id=%s AND osm_type=%s AND osm_id=%s', (dataset_id, osm_type, osm_id)).fetchone():
        raise HTTPException(404, 'Zuerst den zugehörigen JSON-Datenpunkt importieren')
    if not image_storage.configured():
        raise HTTPException(503, 'Der Bildspeicher ist noch nicht eingerichtet. Bitte später erneut versuchen.')
    try:
        key = image_storage.save_image(osm_type, osm_id, kind, body)
    except (BotoCoreError, ClientError) as exc:
        raise HTTPException(503, 'Bildspeicher nicht erreichbar; Upload bitte erneut versuchen') from exc
    connection.execute(
        'INSERT INTO moneta_images (dataset_id, osm_type, osm_id, kind, object_key, content) VALUES (%s,%s,%s,%s,%s,NULL) '
        'ON CONFLICT (dataset_id, osm_type, osm_id, kind) DO UPDATE SET object_key=EXCLUDED.object_key, content=NULL, updated_at=now()',
        (dataset_id, osm_type, osm_id, kind, key),
    )
    return {'ok': True}


@app.get('/api/moneta/records', dependencies=Read)
def list_records(connection: Connection, q: str = Query('', max_length=200), offset: int = Query(0, ge=0), limit: int = Query(25, ge=1, le=100), dataset_id: Annotated[int,Query(ge=1)] = 1):
    pattern = '%' + q + '%'
    count = connection.execute('SELECT count(*) AS total FROM moneta_records WHERE dataset_id=%s AND (name ILIKE %s OR category ILIKE %s OR osm_id::text ILIKE %s)', (dataset_id, pattern, pattern, pattern)).fetchone()['total']
    rows = connection.execute(
        'SELECT r.osm_type, r.osm_id::text AS osm_id, r.name, r.category, r.updated_at, '
        "EXISTS(SELECT 1 FROM moneta_images i WHERE i.dataset_id=r.dataset_id AND i.osm_type=r.osm_type AND i.osm_id=r.osm_id AND kind='osm') AS osm, "
        "EXISTS(SELECT 1 FROM moneta_images i WHERE i.dataset_id=r.dataset_id AND i.osm_type=r.osm_type AND i.osm_id=r.osm_id AND kind='satellite') AS satellite "
        'FROM moneta_records r WHERE dataset_id=%s AND (name ILIKE %s OR category ILIKE %s OR osm_id::text ILIKE %s) ORDER BY r.osm_type,r.osm_id LIMIT %s OFFSET %s',
        (dataset_id, pattern, pattern, pattern, limit, offset),
    ).fetchall()
    return {'total': count, 'items': rows}


@app.get('/api/moneta/records/{osm_type}/{osm_id}', dependencies=Read)
def detail(osm_type: str, osm_id: int, connection: Connection, dataset_id: Annotated[int,Query(ge=1)] = 1):
    row = connection.execute('SELECT data FROM moneta_records WHERE dataset_id=%s AND osm_type=%s AND osm_id=%s', (dataset_id, osm_type, osm_id)).fetchone()
    if not row:
        raise HTTPException(404, 'Datenpunkt nicht gefunden')
    return row['data']


@app.get('/api/moneta/records/{osm_type}/{osm_id}/images/{kind}', dependencies=Read)
def image(osm_type: str, osm_id: int, kind: Literal['osm', 'satellite'], connection: Connection, dataset_id: Annotated[int,Query(ge=1)] = 1):
    row = connection.execute('SELECT content, object_key FROM moneta_images WHERE dataset_id=%s AND osm_type=%s AND osm_id=%s AND kind=%s', (dataset_id, osm_type, osm_id, kind)).fetchone()
    if not row:
        raise HTTPException(404, 'Bild nicht vorhanden')
    if row['object_key']:
        if not image_storage.configured():
            raise HTTPException(503, 'Bildspeicher nicht konfiguriert')
        return RedirectResponse(image_storage.download_url(row['object_key']), status_code=307, headers={'Cache-Control': 'private, no-store'})
    if row['content'] is None:
        raise HTTPException(404, 'Bild nicht vorhanden')
    return Response(bytes(row['content']), media_type='image/png', headers={'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff'})
