"""Nutzerstudie: freely chosen case sets, participant test runs with access codes, timing and questionnaire.

Participants never log in with an account. An admin creates either a test run with its own access code or a shared
code; every redemption of a shared code starts a separate test run. Redeeming a code yields a cookie that only grants
access to the participant endpoints of that single test run. Admins can display the codes again in the dashboard.
Reference classes and evaluation results are never returned by participant endpoints.
"""
import csv
import hashlib
import io
import logging
import os
import re
import secrets
import uuid
from pathlib import Path
from typing import Annotated, Literal

import psycopg
from fastapi import Depends, HTTPException, Query, Request, Response
from fastapi.responses import JSONResponse, RedirectResponse
from psycopg.types.json import Jsonb
from pydantic import BaseModel, ConfigDict, Field

import study_evaluation
from auth import admin_user, origin_check
from main import Connection, app

STUDY_COOKIE = 'wz_study'
CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
MAX_CASES = 50
MAX_QUESTIONS_PER_CASE = 10
CODES = 'ABCDEFGHIJKLMNOPQRSTU'
logger = logging.getLogger(__name__)


@app.exception_handler(psycopg.errors.ForeignKeyViolation)
def study_reference_in_use(request: Request, exc: psycopg.errors.ForeignKeyViolation):
    if (exc.diag.constraint_name or '').startswith('study_'):
        return JSONResponse({'detail': 'Der Klassifikationslauf wird in der Nutzerstudie verwendet und kann nicht gelöscht werden.'}, status_code=409)
    logger.error('Unhandled foreign key violation', exc_info=exc)
    return JSONResponse({'detail': 'Internal Server Error'}, status_code=500)


SCHEMA_MARKER = '-- Nutzerstudie:'
_schema_ready = False


def ensure_schema(connection):
    """Create or update the study tables on first use, so that a deployment needs no manual migration.

    Only the study part of schema.sql is executed (all statements are idempotent). An advisory lock prevents
    concurrent serverless instances from creating the tables at the same time.
    """
    global _schema_ready
    if _schema_ready:
        return
    state = connection.execute(
        "SELECT to_regclass('study_access_tokens') IS NOT NULL AND to_regclass('study_invites') IS NOT NULL AND EXISTS ("
        "SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'study_sessions' "
        "AND column_name = 'invite_id') AS ready").fetchone()
    if not state['ready']:
        ddl = Path(__file__).with_name('schema.sql').read_text(encoding='utf-8').split(SCHEMA_MARKER, 1)[1].split('\n', 1)[1]
        connection.execute('SELECT pg_advisory_xact_lock(7342001)')
        connection.execute(ddl)
        connection.commit()
        logger.info('Nutzerstudie: Tabellen angelegt bzw. aktualisiert')
    _schema_ready = True


def study_connection(connection: Connection):
    ensure_schema(connection)
    return connection


StudyDB = Annotated[psycopg.Connection, Depends(study_connection)]


def secure_cookie():
    return os.environ.get('COOKIE_SECURE', 'false').lower() == 'true'


def normalize_code(code: str) -> str:
    return re.sub(r'[^A-Z0-9]', '', code.upper())


def code_hash(code: str) -> str:
    return hashlib.sha256(('study-access:' + normalize_code(code)).encode()).hexdigest()


def token_hash(token: str) -> str:
    return hashlib.sha256(('study-token:' + token).encode()).hexdigest()


def new_access_code(connection) -> tuple[str, str]:
    while True:
        raw = ''.join(secrets.choice(CODE_ALPHABET) for _ in range(8))
        hashed = code_hash(raw)
        if not connection.execute('SELECT 1 FROM study_sessions WHERE access_hash=%s UNION ALL SELECT 1 FROM study_invites WHERE access_hash=%s',
                                  (hashed, hashed)).fetchone():
            return f'{raw[:4]}-{raw[4:]}', hashed


def ai_code(result):
    return ((result or {}).get('prediction') or {}).get('category')


def confidence(result):
    value = (result or {}).get('confidence')
    return value if isinstance(value, (int, float)) else None


# ---------------------------------------------------------------------------------------------------------------
# Participant endpoints
# ---------------------------------------------------------------------------------------------------------------

def participant(request: Request, connection: StudyDB):
    token = request.cookies.get(STUDY_COOKIE, '')
    if not token or len(token) > 128:
        raise HTTPException(401, 'not_signed_in')
    session = connection.execute(
        'SELECT s.* FROM study_access_tokens t JOIN study_sessions s ON s.id=t.session_id '
        'WHERE t.token_hash=%s AND t.expires_at > now()', (token_hash(token),)).fetchone()
    if not session or session['status'] == 'aborted':
        raise HTTPException(401, 'not_signed_in')
    return session


def locked_session(connection, session, allowed=('running',)):
    row = connection.execute('SELECT * FROM study_sessions WHERE id=%s FOR UPDATE', (session['id'],)).fetchone()
    if row['status'] not in allowed:
        raise HTTPException(409, 'not_started' if row['status'] == 'created' else 'locked')
    return row


def log_event(connection, session_id, action, position=None, data=None):
    connection.execute('INSERT INTO study_events(session_id,position,action,data) VALUES (%s,%s,%s,%s)',
                       (session_id, position, action, Jsonb(data or {})))


def close_interval(connection, session):
    """Add the time since the current case was shown to that case. Time is measured on the server only."""
    if session['current_position'] is not None and session['current_since'] is not None:
        connection.execute(
            'UPDATE study_entries SET active_ms = active_ms + GREATEST(0, (EXTRACT(EPOCH FROM (now() - %s)) * 1000)::bigint) '
            'WHERE session_id=%s AND position=%s', (session['current_since'], session['id'], session['current_position']))
    connection.execute('UPDATE study_sessions SET current_position=NULL, current_since=NULL WHERE id=%s', (session['id'],))


def entry_for_rank(connection, session, rank):
    entry = connection.execute('SELECT * FROM study_entries WHERE session_id=%s AND rank=%s', (session['id'], rank)).fetchone()
    if not entry:
        raise HTTPException(404, 'case_not_found')
    return entry


class Access(BaseModel):
    model_config = ConfigDict(extra='forbid')
    code: str = Field(min_length=1, max_length=40)


@app.post('/api/study/access', dependencies=[Depends(origin_check)])
def redeem(data: Access, request: Request, response: Response, connection: StudyDB):
    client = 'study:' + (request.client.host if request.client else 'unknown')
    attempt = connection.execute(
        "INSERT INTO login_attempts (client, attempts, expires_at) VALUES (%s, 1, now() + interval '15 minutes') "
        'ON CONFLICT (client) DO UPDATE SET attempts = CASE WHEN login_attempts.expires_at <= now() THEN 1 ELSE login_attempts.attempts + 1 END, '
        "expires_at = CASE WHEN login_attempts.expires_at <= now() THEN now() + interval '15 minutes' ELSE login_attempts.expires_at END RETURNING attempts",
        (client,)).fetchone()
    connection.commit()
    if attempt['attempts'] > 30:
        raise HTTPException(429, 'too_many_attempts')
    hashed = code_hash(data.code)
    session = connection.execute('SELECT * FROM study_sessions WHERE access_hash=%s', (hashed,)).fetchone()
    if not session:
        invite = connection.execute('SELECT * FROM study_invites WHERE access_hash=%s', (hashed,)).fetchone()
        if not invite:
            raise HTTPException(401, 'invalid_code')
        if not invite['active']:
            raise HTTPException(410, 'code_used')
        # A shared code starts a separate test run with the next free participant code for every person.
        session_id = add_session(connection, invite['case_set_id'], None, invite['language'], invite['pilot'], invite['created_by'], invite['id'])
        session = connection.execute('SELECT * FROM study_sessions WHERE id=%s', (session_id,)).fetchone()
    if session['status'] in ('completed', 'aborted'):
        raise HTTPException(410, 'code_used')
    connection.execute('DELETE FROM login_attempts WHERE client=%s', (client,))
    connection.execute('DELETE FROM study_access_tokens WHERE expires_at <= now()')
    token = secrets.token_urlsafe(32)
    connection.execute("INSERT INTO study_access_tokens(token_hash,session_id,expires_at) VALUES (%s,%s,now() + interval '6 hours')",
                       (token_hash(token), session['id']))
    log_event(connection, session['id'], 'access')
    response.set_cookie(STUDY_COOKIE, token, max_age=6 * 3600, httponly=True, secure=secure_cookie(), samesite='strict', path='/api/study')
    return {'status': session['status'], 'language': session['language']}


@app.post('/api/study/leave', dependencies=[Depends(origin_check)])
def leave(response: Response):
    response.delete_cookie(STUDY_COOKIE, path='/api/study', httponly=True, samesite='strict', secure=secure_cookie())
    return {'ok': True}


@app.get('/api/study/me')
def me(connection: StudyDB, session=Depends(participant)):
    entries = connection.execute(
        'SELECT e.rank, i.name, e.final_code IS NOT NULL AS decided FROM study_entries e '
        'JOIN classification_run_items i ON i.run_id=%s AND i.position=e.position WHERE e.session_id=%s ORDER BY e.rank',
        (session['run_id'], session['id'])).fetchall()
    return {'participant_code': session['participant_code'], 'language': session['language'], 'status': session['status'],
            'cases': entries if session['status'] != 'created' else [], 'total': len(entries)}


@app.post('/api/study/me/start', dependencies=[Depends(origin_check)])
def start(connection: StudyDB, session=Depends(participant)):
    row = locked_session(connection, session, allowed=('created', 'running'))
    if row['status'] == 'created':
        connection.execute("UPDATE study_sessions SET status='running', started_at=now() WHERE id=%s", (row['id'],))
        log_event(connection, row['id'], 'start')
    return {'ok': True}


@app.get('/api/study/me/cases/{rank}')
def case(rank: int, connection: StudyDB, session=Depends(participant)):
    if session['status'] not in ('running', 'questionnaire', 'completed'):
        raise HTTPException(409, 'not_started')
    entry = entry_for_rank(connection, session, rank)
    item = connection.execute(
        "SELECT i.name, i.result, i.clues, i.snapshot, m.data->'tags' AS tags FROM classification_run_items i "
        'JOIN classification_runs r ON r.id=i.run_id '
        'LEFT JOIN moneta_records m ON m.dataset_id=r.dataset_id AND m.osm_type=i.osm_type AND m.osm_id::text=i.osm_id '
        'WHERE i.run_id=%s AND i.position=%s', (session['run_id'], entry['position'])).fetchone()
    snapshot = item['snapshot'] or {}
    prediction = (item['result'] or {}).get('prediction') or {}
    total = connection.execute('SELECT count(*) AS n FROM study_entries WHERE session_id=%s', (session['id'],)).fetchone()['n']
    # Deliberately no reference class, no OSM id and no correctness information.
    return {
        'rank': rank, 'total': total, 'name': item['name'],
        'texts': snapshot.get('texts', {}), 'tags': snapshot.get('tags', item['tags'] or {}),
        'images': {kind: bool(((snapshot.get('images') or {}).get(kind) or {}).get('object_key')) for kind in ('satellite', 'osm')},
        'clues': {source: (clue or {}).get('text', '') for source, clue in (item['clues'] or {}).items()},
        'ai': {'code': prediction.get('category'), 'confidence': confidence(item['result']),
               'explanation': prediction.get('explanation') or '', 'evidence': prediction.get('evidence') or [],
               'uncertainty': prediction.get('uncertainty') or ''},
        'entry': {'decision': entry['decision'], 'final_code': entry['final_code'], 'certainty': entry['certainty'],
                  'rationale': entry['rationale'], 'messages': [{'question': m['question'], 'answer': m['answer']} for m in entry['messages']]},
    }


@app.get('/api/study/me/cases/{rank}/images/{kind}')
def case_image(rank: int, kind: Literal['osm', 'satellite'], connection: StudyDB, session=Depends(participant)):
    from image_storage import download_url
    if session['status'] not in ('running', 'questionnaire', 'completed'):
        raise HTTPException(409, 'not_started')
    entry = entry_for_rank(connection, session, rank)
    row = connection.execute('SELECT snapshot FROM classification_run_items WHERE run_id=%s AND position=%s', (session['run_id'], entry['position'])).fetchone()
    image = ((row['snapshot'] or {}).get('images') or {}).get(kind) if row else None
    if not image or not image.get('object_key'):
        raise HTTPException(404, 'image_not_found')
    return RedirectResponse(download_url(image['object_key']), status_code=307)


class Event(BaseModel):
    model_config = ConfigDict(extra='forbid')
    action: Literal['show', 'hide']
    rank: int | None = Field(default=None, ge=1, le=MAX_CASES)


@app.post('/api/study/me/events', dependencies=[Depends(origin_check)])
def event(data: Event, connection: StudyDB, session=Depends(participant)):
    row = locked_session(connection, session)
    if data.action == 'hide':
        if row['current_position'] is not None:
            close_interval(connection, row)
            log_event(connection, row['id'], 'hide', row['current_position'])
        return {'ok': True}
    if data.rank is None:
        raise HTTPException(422, 'rank_required')
    entry = entry_for_rank(connection, row, data.rank)
    if row['current_position'] == entry['position']:
        return {'ok': True}
    close_interval(connection, row)
    connection.execute('UPDATE study_entries SET visits=visits+1, first_shown_at=COALESCE(first_shown_at, now()) WHERE session_id=%s AND position=%s',
                       (row['id'], entry['position']))
    connection.execute('UPDATE study_sessions SET current_position=%s, current_since=now() WHERE id=%s', (entry['position'], row['id']))
    log_event(connection, row['id'], 'show', entry['position'], {'rank': data.rank})
    return {'ok': True}


class Decision(BaseModel):
    model_config = ConfigDict(extra='forbid')
    final_code: str = Field(pattern='^[A-U]$')
    certainty: int = Field(ge=1, le=5)
    rationale: str = Field(min_length=1, max_length=5000, pattern=r'\S')


@app.post('/api/study/me/cases/{rank}/decision', dependencies=[Depends(origin_check)])
def decide(rank: int, data: Decision, connection: StudyDB, session=Depends(participant)):
    row = locked_session(connection, session)
    entry = entry_for_rank(connection, row, rank)
    result = connection.execute('SELECT result FROM classification_run_items WHERE run_id=%s AND position=%s', (row['run_id'], entry['position'])).fetchone()['result']
    decision = 'confirmed' if data.final_code == ai_code(result) else 'corrected'
    connection.execute(
        'UPDATE study_entries SET decision=%s, final_code=%s, certainty=%s, rationale=%s, '
        'first_saved_at=COALESCE(first_saved_at, now()), last_saved_at=now() WHERE session_id=%s AND position=%s',
        (decision, data.final_code, data.certainty, data.rationale.strip(), row['id'], entry['position']))
    log_event(connection, row['id'], 'save', entry['position'],
              {'rank': rank, 'decision': decision, 'final_code': data.final_code, 'certainty': data.certainty, 'rationale': data.rationale.strip()})
    return {'ok': True, 'decision': decision}


class Question(BaseModel):
    model_config = ConfigDict(extra='forbid')
    question: str = Field(min_length=1, max_length=2000, pattern=r'\S')


@app.post('/api/study/me/cases/{rank}/chat', dependencies=[Depends(origin_check)])
def chat(rank: int, data: Question, connection: StudyDB, session=Depends(participant)):
    import case_chat
    row = locked_session(connection, session)
    entry = entry_for_rank(connection, row, rank)
    if len(entry['messages']) >= MAX_QUESTIONS_PER_CASE:
        raise HTTPException(429, 'question_limit')
    item = connection.execute('SELECT * FROM classification_run_items WHERE run_id=%s AND position=%s', (row['run_id'], entry['position'])).fetchone()
    run = connection.execute('SELECT model FROM classification_runs WHERE id=%s', (row['run_id'],)).fetchone()
    history = [{'question': m['question'], 'answer': m['answer']} for m in entry['messages']]
    answer, model = case_chat.ask(connection, None, run['model'], item, history, data.question.strip(), row['language'])
    message = {'question': data.question.strip(), 'answer': answer, 'model': model}
    connection.execute('UPDATE study_entries SET messages = messages || %s WHERE session_id=%s AND position=%s',
                       (Jsonb([message]), row['id'], entry['position']))
    log_event(connection, row['id'], 'chat', entry['position'], {'rank': rank, 'question': message['question'], 'model': model})
    return {'question': message['question'], 'answer': answer}


@app.post('/api/study/me/finish-cases', dependencies=[Depends(origin_check)])
def finish_cases(connection: StudyDB, session=Depends(participant)):
    row = locked_session(connection, session)
    if connection.execute('SELECT 1 FROM study_entries WHERE session_id=%s AND final_code IS NULL', (row['id'],)).fetchone():
        raise HTTPException(409, 'cases_open')
    close_interval(connection, row)
    connection.execute("UPDATE study_sessions SET status='questionnaire', cases_finished_at=now() WHERE id=%s", (row['id'],))
    log_event(connection, row['id'], 'finish_cases')
    return {'ok': True}


Scale = Annotated[int, Field(ge=0, le=100, multiple_of=5)]


class Tlx(BaseModel):
    model_config = ConfigDict(extra='forbid')
    mental: Scale
    physical: Scale
    temporal: Scale
    performance: Scale
    effort: Scale
    frustration: Scale


class Questionnaire(BaseModel):
    model_config = ConfigDict(extra='forbid')
    tlx: Tlx
    usability: int = Field(ge=1, le=5)
    comment: str = Field(default='', max_length=5000)


@app.post('/api/study/me/questionnaire', dependencies=[Depends(origin_check)])
def questionnaire(data: Questionnaire, connection: StudyDB, session=Depends(participant)):
    row = locked_session(connection, session, allowed=('questionnaire',))
    tlx = data.tlx.model_dump()
    connection.execute(
        'INSERT INTO study_questionnaires(session_id,language,answers,raw_tlx,usability,comment) VALUES (%s,%s,%s,%s,%s,%s)',
        (row['id'], row['language'], Jsonb({'tlx': tlx, 'usability': data.usability}), study_evaluation.raw_tlx(tlx), data.usability, data.comment.strip()))
    connection.execute("UPDATE study_sessions SET status='completed', finished_at=now() WHERE id=%s", (row['id'],))
    log_event(connection, row['id'], 'questionnaire')
    return {'ok': True}


# ---------------------------------------------------------------------------------------------------------------
# Admin endpoints: case sets
# ---------------------------------------------------------------------------------------------------------------

@app.get('/api/study/admin/runs', dependencies=[Depends(admin_user)])
def admin_runs(connection: StudyDB):
    return {'items': connection.execute(
        "SELECT r.id, r.name, r.model, r.created_at, u.username AS owner, count(*) FILTER (WHERE i.state='done') AS done, count(*) AS total "
        'FROM classification_runs r JOIN app_users u ON u.id=r.user_id JOIN classification_run_items i ON i.run_id=r.id '
        "GROUP BY r.id, u.username HAVING count(*) FILTER (WHERE i.state='done') > 0 ORDER BY r.created_at DESC LIMIT 200").fetchall()}


@app.get('/api/study/admin/runs/{run_id}/candidates', dependencies=[Depends(admin_user)])
def candidates(run_id: uuid.UUID, connection: StudyDB):
    if not connection.execute('SELECT 1 FROM classification_runs WHERE id=%s', (run_id,)).fetchone():
        raise HTTPException(404, 'Lauf nicht gefunden.')
    rows = connection.execute(
        "SELECT position, name, osm_type, osm_id, reference, result, snapshot FROM classification_run_items WHERE run_id=%s AND state='done' ORDER BY position",
        (run_id,)).fetchall()
    items = []
    for row in rows:
        snapshot = row['snapshot'] or {}
        code = ai_code(row['result'])
        items.append({'position': row['position'], 'name': row['name'], 'osm': f"{row['osm_type']}_{row['osm_id']}",
                      'reference': row['reference'], 'ai_code': code, 'confidence': confidence(row['result']),
                      'correct': code == row['reference'] if row['reference'] in CODES else None,
                      'texts': len(snapshot.get('texts') or {}),
                      'images': sum(bool((v or {}).get('object_key')) for v in (snapshot.get('images') or {}).values())})
    return {'items': items}


class CaseSet(BaseModel):
    model_config = ConfigDict(extra='forbid')
    name: str = Field(min_length=1, max_length=150, pattern=r'\S')
    run_id: uuid.UUID
    positions: list[int] = Field(min_length=1, max_length=MAX_CASES)
    threshold: float | None = Field(default=None, ge=0, le=1)
    note: str = Field(default='', max_length=2000)


def validate_positions(connection, run_id, positions):
    if len(set(positions)) != len(positions):
        raise HTTPException(422, 'Ein Fall ist mehrfach ausgewählt.')
    found = connection.execute("SELECT count(*) AS n FROM classification_run_items WHERE run_id=%s AND state='done' AND position = ANY(%s)",
                               (run_id, positions)).fetchone()['n']
    if found != len(positions):
        raise HTTPException(422, 'Es können nur abgeschlossene Fälle des gewählten Laufs ausgewählt werden.')


def case_set_locked(connection, case_set_id):
    """A case set is frozen once a real (non-pilot) test run exists. Pilot runs keep it editable."""
    return bool(connection.execute("SELECT 1 FROM study_sessions WHERE case_set_id=%s AND NOT pilot AND status <> 'aborted' LIMIT 1",
                                   (case_set_id,)).fetchone())


@app.get('/api/study/admin/case-sets', dependencies=[Depends(admin_user)])
def case_sets(connection: StudyDB):
    rows = connection.execute(
        'SELECT c.*, r.name AS run_name, r.model, u.username AS created_by_name, '
        '(SELECT count(*) FROM study_sessions s WHERE s.case_set_id=c.id) AS sessions, '
        "(SELECT count(*) FROM study_sessions s WHERE s.case_set_id=c.id AND NOT s.pilot AND s.status <> 'aborted') AS real_sessions "
        'FROM study_case_sets c JOIN classification_runs r ON r.id=c.run_id JOIN app_users u ON u.id=c.created_by ORDER BY c.created_at DESC').fetchall()
    for row in rows:
        row['locked'] = row['real_sessions'] > 0
    return {'items': rows}


@app.post('/api/study/admin/case-sets', status_code=201, dependencies=[Depends(origin_check)])
def create_case_set(data: CaseSet, connection: StudyDB, user=Depends(admin_user)):
    if not connection.execute('SELECT 1 FROM classification_runs WHERE id=%s', (data.run_id,)).fetchone():
        raise HTTPException(404, 'Lauf nicht gefunden.')
    validate_positions(connection, data.run_id, data.positions)
    return connection.execute('INSERT INTO study_case_sets(name,run_id,positions,threshold,note,created_by) VALUES (%s,%s,%s,%s,%s,%s) RETURNING *',
                              (data.name.strip(), data.run_id, data.positions, data.threshold, data.note.strip(), user['id'])).fetchone()


@app.put('/api/study/admin/case-sets/{case_set_id}', dependencies=[Depends(origin_check), Depends(admin_user)])
def update_case_set(case_set_id: int, data: CaseSet, connection: StudyDB):
    current = connection.execute('SELECT * FROM study_case_sets WHERE id=%s FOR UPDATE', (case_set_id,)).fetchone()
    if not current:
        raise HTTPException(404, 'Fallset nicht gefunden.')
    if case_set_locked(connection, case_set_id):
        raise HTTPException(409, 'Für dieses Fallset gibt es bereits echte Testläufe. Bitte eine Kopie anlegen und diese anpassen.')
    if data.run_id != current['run_id'] and connection.execute('SELECT 1 FROM study_sessions WHERE case_set_id=%s', (case_set_id,)).fetchone():
        raise HTTPException(409, 'Der Lauf kann nach den ersten Probeläufen nicht mehr gewechselt werden. Bitte ein neues Fallset anlegen.')
    validate_positions(connection, data.run_id, data.positions)
    return connection.execute('UPDATE study_case_sets SET name=%s, run_id=%s, positions=%s, threshold=%s, note=%s, updated_at=now() WHERE id=%s RETURNING *',
                              (data.name.strip(), data.run_id, data.positions, data.threshold, data.note.strip(), case_set_id)).fetchone()


@app.post('/api/study/admin/case-sets/{case_set_id}/copy', status_code=201, dependencies=[Depends(origin_check)])
def copy_case_set(case_set_id: int, connection: StudyDB, user=Depends(admin_user)):
    current = connection.execute('SELECT * FROM study_case_sets WHERE id=%s', (case_set_id,)).fetchone()
    if not current:
        raise HTTPException(404, 'Fallset nicht gefunden.')
    name = (current['name'][:142] + ' (Kopie)')
    return connection.execute('INSERT INTO study_case_sets(name,run_id,positions,threshold,note,created_by) VALUES (%s,%s,%s,%s,%s,%s) RETURNING *',
                              (name, current['run_id'], current['positions'], current['threshold'], current['note'], user['id'])).fetchone()


@app.delete('/api/study/admin/case-sets/{case_set_id}', dependencies=[Depends(origin_check), Depends(admin_user)])
def delete_case_set(case_set_id: int, connection: StudyDB):
    if connection.execute('SELECT 1 FROM study_sessions WHERE case_set_id=%s UNION ALL SELECT 1 FROM study_invites WHERE case_set_id=%s',
                          (case_set_id, case_set_id)).fetchone():
        raise HTTPException(409, 'Zu diesem Fallset gibt es Testläufe oder Mehrfach-Codes. Bitte diese zuerst löschen.')
    if not connection.execute('DELETE FROM study_case_sets WHERE id=%s RETURNING id', (case_set_id,)).fetchone():
        raise HTTPException(404, 'Fallset nicht gefunden.')
    return {'ok': True}


# ---------------------------------------------------------------------------------------------------------------
# Admin endpoints: test runs
# ---------------------------------------------------------------------------------------------------------------

class NewSession(BaseModel):
    model_config = ConfigDict(extra='forbid')
    case_set_id: int
    participant_code: str = Field(pattern=r'^[A-Za-z0-9_-]{1,20}$')
    language: Literal['de', 'en'] = 'de'
    pilot: bool = False


def next_participant_code(connection, case_set_id, pilot):
    prefix = 'T' if pilot else 'P'
    numbers = [int(match.group(1)) for row in connection.execute('SELECT participant_code FROM study_sessions WHERE case_set_id=%s AND pilot=%s',
                                                                  (case_set_id, pilot)).fetchall()
               if (match := re.fullmatch(prefix + r'(\d+)', row['participant_code'], re.IGNORECASE))]
    return f'{prefix}{(max(numbers) if numbers else 0) + 1:02d}'


def add_session(connection, case_set_id, participant_code, language, pilot, created_by, invite_id=None):
    """Create a test run with its own random case order. Returns the id; the access code is set separately."""
    case_set = connection.execute('SELECT * FROM study_case_sets WHERE id=%s FOR UPDATE', (case_set_id,)).fetchone()
    if not case_set:
        raise HTTPException(404, 'Fallset nicht gefunden.')
    participant_code = participant_code or next_participant_code(connection, case_set_id, pilot)
    if not pilot and connection.execute(
            "SELECT 1 FROM study_sessions WHERE case_set_id=%s AND lower(participant_code)=lower(%s) AND NOT pilot AND status <> 'aborted'",
            (case_set_id, participant_code)).fetchone():
        raise HTTPException(409, 'Dieser Teilnehmercode ist für das Fallset bereits vergeben.')
    order = list(case_set['positions'])
    secrets.SystemRandom().shuffle(order)
    session_id = uuid.uuid4()
    # Test runs started from a shared code get an unusable random hash; they are reached via their cookie only.
    connection.execute('INSERT INTO study_sessions(id,case_set_id,run_id,participant_code,access_hash,language,pilot,case_order,created_by,invite_id) '
                       'VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)',
                       (session_id, case_set['id'], case_set['run_id'], participant_code, 'unused:' + secrets.token_hex(24), language, pilot,
                        order, created_by, invite_id))
    with connection.cursor() as cursor:
        cursor.executemany('INSERT INTO study_entries(session_id,position,rank) VALUES (%s,%s,%s)',
                           [(session_id, position, rank) for rank, position in enumerate(order, start=1)])
    log_event(connection, session_id, 'created', data={'invite_id': invite_id} if invite_id else {})
    return session_id


@app.post('/api/study/admin/sessions', status_code=201, dependencies=[Depends(origin_check)])
def create_session(data: NewSession, connection: StudyDB, user=Depends(admin_user)):
    session_id = add_session(connection, data.case_set_id, data.participant_code, data.language, data.pilot, user['id'])
    code, hashed = new_access_code(connection)
    connection.execute('UPDATE study_sessions SET access_hash=%s, access_code=%s WHERE id=%s', (hashed, code, session_id))
    return {'id': session_id, 'access_code': code}


@app.post('/api/study/admin/sessions/{session_id}/code', dependencies=[Depends(origin_check), Depends(admin_user)])
def regenerate_code(session_id: uuid.UUID, connection: StudyDB):
    session = connection.execute('SELECT * FROM study_sessions WHERE id=%s FOR UPDATE', (session_id,)).fetchone()
    if not session:
        raise HTTPException(404, 'Testlauf nicht gefunden.')
    if session['status'] in ('completed', 'aborted'):
        raise HTTPException(409, 'Für abgeschlossene oder abgebrochene Testläufe wird kein Code mehr erzeugt.')
    code, hashed = new_access_code(connection)
    connection.execute('UPDATE study_sessions SET access_hash=%s, access_code=%s WHERE id=%s', (hashed, code, session_id))
    log_event(connection, session_id, 'code_regenerated')
    return {'access_code': code}


@app.post('/api/study/admin/sessions/{session_id}/abort', dependencies=[Depends(origin_check), Depends(admin_user)])
def abort_session(session_id: uuid.UUID, connection: StudyDB):
    session = connection.execute('SELECT * FROM study_sessions WHERE id=%s FOR UPDATE', (session_id,)).fetchone()
    if not session:
        raise HTTPException(404, 'Testlauf nicht gefunden.')
    if session['status'] in ('completed', 'aborted'):
        raise HTTPException(409, 'Der Testlauf ist bereits beendet.')
    close_interval(connection, session)
    connection.execute("UPDATE study_sessions SET status='aborted', finished_at=now() WHERE id=%s", (session_id,))
    connection.execute('DELETE FROM study_access_tokens WHERE session_id=%s', (session_id,))
    log_event(connection, session_id, 'aborted')
    return {'ok': True}


@app.delete('/api/study/admin/sessions/{session_id}', dependencies=[Depends(origin_check), Depends(admin_user)])
def delete_session(session_id: uuid.UUID, connection: StudyDB):
    if not connection.execute('DELETE FROM study_sessions WHERE id=%s RETURNING id', (session_id,)).fetchone():
        raise HTTPException(404, 'Testlauf nicht gefunden.')
    return {'ok': True}


class NewInvite(BaseModel):
    model_config = ConfigDict(extra='forbid')
    case_set_id: int
    language: Literal['de', 'en'] = 'de'
    pilot: bool = False


@app.get('/api/study/admin/invites', dependencies=[Depends(admin_user)])
def invites(connection: StudyDB):
    return {'items': connection.execute(
        'SELECT i.id, i.case_set_id, c.name AS case_set_name, i.access_code, i.language, i.pilot, i.active, i.created_at, u.username AS created_by_name, '
        '(SELECT count(*) FROM study_sessions s WHERE s.invite_id=i.id) AS sessions, '
        "(SELECT count(*) FROM study_sessions s WHERE s.invite_id=i.id AND s.status='completed') AS completed "
        'FROM study_invites i JOIN study_case_sets c ON c.id=i.case_set_id JOIN app_users u ON u.id=i.created_by ORDER BY i.created_at DESC').fetchall()}


@app.post('/api/study/admin/invites', status_code=201, dependencies=[Depends(origin_check)])
def create_invite(data: NewInvite, connection: StudyDB, user=Depends(admin_user)):
    if not connection.execute('SELECT 1 FROM study_case_sets WHERE id=%s', (data.case_set_id,)).fetchone():
        raise HTTPException(404, 'Fallset nicht gefunden.')
    code, hashed = new_access_code(connection)
    row = connection.execute('INSERT INTO study_invites(case_set_id,access_hash,access_code,language,pilot,created_by) VALUES (%s,%s,%s,%s,%s,%s) RETURNING id',
                             (data.case_set_id, hashed, code, data.language, data.pilot, user['id'])).fetchone()
    return {'id': row['id'], 'access_code': code}


class InviteState(BaseModel):
    model_config = ConfigDict(extra='forbid')
    active: bool


@app.post('/api/study/admin/invites/{invite_id}/active', dependencies=[Depends(origin_check), Depends(admin_user)])
def set_invite_active(invite_id: int, data: InviteState, connection: StudyDB):
    if not connection.execute('UPDATE study_invites SET active=%s WHERE id=%s RETURNING id', (data.active, invite_id)).fetchone():
        raise HTTPException(404, 'Mehrfach-Code nicht gefunden.')
    return {'ok': True}


@app.delete('/api/study/admin/invites/{invite_id}', dependencies=[Depends(origin_check), Depends(admin_user)])
def delete_invite(invite_id: int, connection: StudyDB):
    # Test runs started with this code are kept; they only lose the reference to the code.
    if not connection.execute('DELETE FROM study_invites WHERE id=%s RETURNING id', (invite_id,)).fetchone():
        raise HTTPException(404, 'Mehrfach-Code nicht gefunden.')
    return {'ok': True}


def entry_rows(connection, where='TRUE', params=()):
    rows = connection.execute(
        'SELECT s.id AS session_id, s.participant_code, s.pilot, s.status, s.case_set_id, e.position, e.rank, i.name, i.reference, i.result, '
        'e.decision, e.final_code, e.certainty, e.rationale, e.active_ms, e.visits, jsonb_array_length(e.messages) AS chats, e.messages, '
        'e.first_shown_at, e.first_saved_at, e.last_saved_at, '
        "(SELECT count(*) FROM study_events v WHERE v.session_id=e.session_id AND v.position=e.position AND v.action='save') AS saves "
        'FROM study_entries e JOIN study_sessions s ON s.id=e.session_id '
        'JOIN classification_run_items i ON i.run_id=s.run_id AND i.position=e.position '
        f'WHERE {where} ORDER BY s.created_at, e.rank', params).fetchall()
    for row in rows:
        result = row.pop('result')
        row['ai_code'] = ai_code(result)
        row['confidence'] = confidence(result)
        row['outcome'] = study_evaluation.outcome(row)
        row['correct'] = row['final_code'] == row['reference'] if row['outcome'] else None
        row['changes'] = max(0, row['saves'] - 1)
    return rows


def session_rows(connection, where='TRUE', params=()):
    sessions = connection.execute(
        'SELECT s.id, s.case_set_id, c.name AS case_set_name, s.participant_code, s.language, s.pilot, s.status, s.created_at, s.started_at, '
        's.cases_finished_at, s.finished_at, EXTRACT(EPOCH FROM (s.cases_finished_at - s.started_at)) AS case_seconds, '
        'q.raw_tlx, q.usability, u.username AS created_by_name, s.access_code, s.invite_id '
        'FROM study_sessions s JOIN study_case_sets c ON c.id=s.case_set_id JOIN app_users u ON u.id=s.created_by '
        f'LEFT JOIN study_questionnaires q ON q.session_id=s.id WHERE {where} ORDER BY s.created_at DESC', params).fetchall()
    entries = entry_rows(connection, f's.id = ANY(%s)', ([s['id'] for s in sessions],)) if sessions else []
    by_session = {}
    for row in entries:
        by_session.setdefault(row['session_id'], []).append(row)
    for session in sessions:
        rows = by_session.get(session['id'], [])
        scored = [row for row in rows if row['outcome']]
        session['total'] = len(rows)
        session['decided'] = sum(row['final_code'] is not None for row in rows)
        session['correct'] = sum(row['correct'] for row in scored)
        session['scored'] = len(scored)
        session['accuracy'] = session['correct'] / len(scored) if scored else None
        session['chats'] = sum(row['chats'] for row in rows)
        session['active_seconds'] = sum(row['active_ms'] for row in rows) / 1000
    return sessions


@app.get('/api/study/admin/sessions', dependencies=[Depends(admin_user)])
def sessions(connection: StudyDB):
    return {'items': session_rows(connection)}


@app.get('/api/study/admin/sessions/{session_id}', dependencies=[Depends(admin_user)])
def session_detail(session_id: uuid.UUID, connection: StudyDB):
    rows = session_rows(connection, 's.id=%s', (session_id,))
    if not rows:
        raise HTTPException(404, 'Testlauf nicht gefunden.')
    questionnaire_row = connection.execute('SELECT * FROM study_questionnaires WHERE session_id=%s', (session_id,)).fetchone()
    events = connection.execute('SELECT id, position, action, data, created_at FROM study_events WHERE session_id=%s ORDER BY id', (session_id,)).fetchall()
    return {'session': rows[0], 'entries': entry_rows(connection, 's.id=%s', (session_id,)), 'questionnaire': questionnaire_row, 'events': events}


def evaluation_filter(case_set_id, include_pilot):
    where, params = "s.status IN ('questionnaire', 'completed')", []
    if not include_pilot:
        where += ' AND NOT s.pilot'
    if case_set_id is not None:
        where += ' AND s.case_set_id=%s'
        params.append(case_set_id)
    return where, tuple(params)


@app.get('/api/study/admin/evaluation', dependencies=[Depends(admin_user)])
def evaluation(connection: StudyDB, case_set_id: int | None = None, include_pilot: bool = False):
    where, params = evaluation_filter(case_set_id, include_pilot)
    entries = entry_rows(connection, where, params)
    questionnaires = connection.execute(f'SELECT q.* FROM study_questionnaires q JOIN study_sessions s ON s.id=q.session_id WHERE {where}', params).fetchall()
    return {'metrics': study_evaluation.evaluate(entries, questionnaires), 'sessions': session_rows(connection, where, params)}


ENTRY_COLUMNS = ['participant_code', 'pilot', 'session_id', 'case_set_id', 'rank', 'position', 'name', 'reference', 'ai_code', 'confidence',
                 'decision', 'final_code', 'correct', 'outcome', 'certainty', 'certainty_normalized', 'active_seconds', 'visits', 'chats',
                 'changes', 'rationale', 'first_shown_at', 'first_saved_at', 'last_saved_at']
QUESTIONNAIRE_COLUMNS = ['participant_code', 'pilot', 'session_id', 'case_set_id', 'language', *[f'tlx_{s}' for s in study_evaluation.TLX_SCALES],
                         'raw_tlx', 'usability', 'comment', 'submitted_at']


def csv_response(columns, rows, filename):
    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=columns, extrasaction='ignore')
    writer.writeheader()
    writer.writerows(rows)
    # UTF-8 BOM so that Excel opens umlauts correctly.
    return Response('﻿' + buffer.getvalue(), media_type='text/csv; charset=utf-8',
                    headers={'Content-Disposition': f'attachment; filename="{filename}"'})


@app.get('/api/study/admin/export', dependencies=[Depends(admin_user)])
def export(connection: StudyDB, kind: Literal['json', 'entries', 'questionnaires'] = 'json', case_set_id: int | None = None,
           include_pilot: bool = False, all_sessions: Annotated[bool, Query()] = False):
    where, params = ('TRUE', ()) if all_sessions else evaluation_filter(case_set_id, include_pilot)
    entries = entry_rows(connection, where, params)
    questionnaires = connection.execute(
        f'SELECT q.*, s.participant_code, s.pilot, s.case_set_id FROM study_questionnaires q JOIN study_sessions s ON s.id=q.session_id WHERE {where}',
        params).fetchall()
    if kind == 'entries':
        for row in entries:
            row['certainty_normalized'] = study_evaluation.certainty_normalized(row['certainty'])
            row['active_seconds'] = row['active_ms'] / 1000
        return csv_response(ENTRY_COLUMNS, entries, 'nutzerstudie-entscheidungen.csv')
    if kind == 'questionnaires':
        for row in questionnaires:
            row.update({f'tlx_{scale}': value for scale, value in row['answers']['tlx'].items()})
        return csv_response(QUESTIONNAIRE_COLUMNS, questionnaires, 'nutzerstudie-fragebogen.csv')
    sessions_list = session_rows(connection, where, params)
    events = connection.execute(f'SELECT v.* FROM study_events v JOIN study_sessions s ON s.id=v.session_id WHERE {where} ORDER BY v.id', params).fetchall()
    case_sets_list = connection.execute('SELECT * FROM study_case_sets ORDER BY id').fetchall()
    return {'case_sets': case_sets_list, 'sessions': sessions_list, 'entries': entries, 'questionnaires': questionnaires, 'events': events}
