"""End-to-end test of the user study (Nutzerstudie) API against a real PostgreSQL schema."""
import os
import uuid
from pathlib import Path
from types import SimpleNamespace

import psycopg
import pytest
from fastapi.testclient import TestClient
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

import main
from auth import admin_user, current_user

ORIGIN = {'Origin': 'http://localhost:5173'}
ITEMS = [  # position, reference, ai, confidence
    (0, 'G', 'G', 0.55), (1, 'C', 'G', 0.62), (2, 'I', 'I', 0.31), (3, 'F', 'M', 0.74), (4, 'K', 'K', 0.95), (5, 'A', 'A', 0.5),
]


@pytest.fixture()
def study(monkeypatch):
    url = os.environ.get('TEST_DATABASE_URL')
    if not url:
        pytest.skip('TEST_DATABASE_URL fehlt')
    url = url.replace('-pooler.', '.')
    schema = 'study_test_' + uuid.uuid4().hex
    with psycopg.connect(url, autocommit=True) as c:
        c.execute(f'CREATE SCHEMA {schema}')
    run_id = uuid.uuid4()
    with psycopg.connect(url, options=f'-c search_path={schema}', row_factory=dict_row) as c:
        c.execute(Path(__file__).with_name('schema.sql').read_text())
        admin = c.execute("INSERT INTO app_users(username,password_hash,is_admin) VALUES('admin','unused',true) RETURNING id, username, is_admin").fetchone()
        c.execute("INSERT INTO classification_runs(id,user_id,name,model,prompt,sources) VALUES(%s,%s,'Studienlauf','gpt-5-mini','p','{}')", (run_id, admin['id']))
        for position, reference, ai, conf in ITEMS:
            c.execute("INSERT INTO classification_run_items(run_id,position,osm_type,osm_id,name,reference,snapshot,state,result) "
                      "VALUES(%s,%s,'way',%s,%s,%s,%s,'done',%s)",
                      (run_id, position, position + 100, f'Firma {position}', reference,
                       Jsonb({'texts': {'website': f'Text {position}'}, 'images': {'osm': {'object_key': 'k'}}}),
                       Jsonb({'prediction': {'category': ai, 'explanation': 'Begründung'}, 'confidence': conf})))
        c.execute("INSERT INTO classification_run_items(run_id,position,osm_type,osm_id,name,reference,snapshot,state) VALUES(%s,9,'way',9,'Offen','B','{}','pending')", (run_id,))

    def database():
        with psycopg.connect(url, options=f'-c search_path={schema}', row_factory=dict_row) as connection:
            yield connection

    prompts = []

    def fake_model(connection, user, model, prompt, content, clue=False):
        prompts.append(prompt)
        return SimpleNamespace(model='test-model'), 'Antwort aus den Quellen.'

    import classification_api
    monkeypatch.setattr(classification_api, 'model_call', fake_model)
    main.app.dependency_overrides[main.database] = database
    main.app.dependency_overrides[admin_user] = lambda: admin
    main.app.dependency_overrides[current_user] = lambda: admin
    try:
        yield SimpleNamespace(url=url, schema=schema, run_id=run_id, admin=admin, prompts=prompts,
                              db=lambda: psycopg.connect(url, options=f'-c search_path={schema}', row_factory=dict_row))
    finally:
        main.app.dependency_overrides.clear()
        with psycopg.connect(url, autocommit=True) as c:
            c.execute(f'DROP SCHEMA {schema} CASCADE')


def test_full_study_flow(study):
    admin = TestClient(main.app, headers=ORIGIN)
    person = TestClient(main.app, headers=ORIGIN)

    # Case sets can be chosen freely from finished cases of a run.
    assert admin.get('/api/study/admin/runs').json()['items'][0]['done'] == 6
    candidates = admin.get(f'/api/study/admin/runs/{study.run_id}/candidates').json()['items']
    assert len(candidates) == 6 and candidates[1]['correct'] is False
    body = {'name': 'Pilot', 'run_id': str(study.run_id), 'positions': [0, 1, 2], 'threshold': 0.8}
    assert admin.post('/api/study/admin/case-sets', json={**body, 'positions': [0, 0]}).status_code == 422
    assert admin.post('/api/study/admin/case-sets', json={**body, 'positions': [0, 9]}).status_code == 422
    case_set = admin.post('/api/study/admin/case-sets', json=body).json()
    updated = admin.put(f"/api/study/admin/case-sets/{case_set['id']}", json={**body, 'name': 'Hauptstudie', 'positions': [0, 1, 2, 3]})
    assert updated.status_code == 200 and updated.json()['positions'] == [0, 1, 2, 3]

    # Pilot runs keep the case set editable; real runs freeze it.
    pilot = admin.post('/api/study/admin/sessions', json={'case_set_id': case_set['id'], 'participant_code': 'P01', 'pilot': True}).json()
    assert admin.put(f"/api/study/admin/case-sets/{case_set['id']}", json={**body, 'positions': [0, 1, 2, 3]}).status_code == 200
    created = admin.post('/api/study/admin/sessions', json={'case_set_id': case_set['id'], 'participant_code': 'P01', 'language': 'en'})
    assert created.status_code == 201
    session_id, code = created.json()['id'], created.json()['access_code']
    assert len(code) == 9 and code[4] == '-'
    assert admin.post('/api/study/admin/sessions', json={'case_set_id': case_set['id'], 'participant_code': 'p01'}).status_code == 409
    assert admin.put(f"/api/study/admin/case-sets/{case_set['id']}", json=body).status_code == 409
    assert admin.delete(f"/api/study/admin/case-sets/{case_set['id']}").status_code == 409
    copy = admin.post(f"/api/study/admin/case-sets/{case_set['id']}/copy")
    assert copy.status_code == 201 and copy.json()['positions'] == [0, 1, 2, 3]
    assert admin.get('/api/study/admin/case-sets').json()['items'][1]['locked'] is True

    # Participants only need the access code; codes are case-insensitive and the dash is optional.
    assert person.get('/api/study/me').status_code == 401
    assert person.post('/api/study/access', json={'code': 'AAAA-AAAA'}).status_code == 401
    assert person.post('/api/study/access', json={'code': code}, headers={'Origin': 'https://evil.example'}).status_code == 403
    access = person.post('/api/study/access', json={'code': code.replace('-', '').lower()})
    assert access.status_code == 200 and access.json() == {'status': 'created', 'language': 'en'}
    me = person.get('/api/study/me').json()
    assert me['status'] == 'created' and me['cases'] == [] and me['total'] == 4
    assert person.get('/api/study/me/cases/1').status_code == 409
    assert person.post('/api/study/me/start').status_code == 200
    me = person.get('/api/study/me').json()
    assert me['status'] == 'running' and [c['rank'] for c in me['cases']] == [1, 2, 3, 4]

    # No reference information reaches the participant.
    for rank in range(1, 5):
        response = person.get(f'/api/study/me/cases/{rank}')
        assert response.status_code == 200
        data = response.json()
        assert 'reference' not in response.text and 'osm' not in data and data['images'] == {'satellite': False, 'osm': True}
        assert data['ai']['explanation'] == 'Begründung' and data['texts']['website'].startswith('Text')
    assert person.get('/api/study/me/cases/5').status_code == 404
    assert admin.get('/api/study/me').status_code == 401  # admin cookie jar has no participant token

    # Time is summed per case over all visits, measured on the server.
    person.post('/api/study/me/events', json={'action': 'show', 'rank': 1})
    with study.db() as c:
        c.execute("UPDATE study_sessions SET current_since = current_since - interval '5 seconds' WHERE id=%s", (session_id,))
    person.post('/api/study/me/events', json={'action': 'show', 'rank': 2})
    with study.db() as c:
        c.execute("UPDATE study_sessions SET current_since = current_since - interval '3 seconds' WHERE id=%s", (session_id,))
    person.post('/api/study/me/events', json={'action': 'show', 'rank': 1})
    person.post('/api/study/me/events', json={'action': 'show', 'rank': 1})  # same case again: no new visit
    with study.db() as c:
        c.execute("UPDATE study_sessions SET current_since = current_since - interval '2 seconds' WHERE id=%s", (session_id,))
    person.post('/api/study/me/events', json={'action': 'hide'})
    with study.db() as c:
        timing = {row['rank']: row for row in c.execute('SELECT rank, active_ms, visits FROM study_entries WHERE session_id=%s', (session_id,)).fetchall()}
    assert 7000 <= timing[1]['active_ms'] < 8000 and timing[1]['visits'] == 2
    assert 3000 <= timing[2]['active_ms'] < 4000 and timing[2]['visits'] == 1

    # Questions are answered in the language of the test run.
    answer = person.post('/api/study/me/cases/1/chat', json={'question': 'Why this class?'})
    assert answer.json()['answer'] == 'Antwort aus den Quellen.' and 'in English' in study.prompts[-1]
    assert person.post('/api/study/me/cases/1/chat', json={'question': '   '}).status_code == 422

    # Decisions need class, certainty and rationale; finishing needs all cases decided.
    assert person.post('/api/study/me/cases/1/decision', json={'final_code': 'G', 'certainty': 4, 'rationale': ' '}).status_code == 422
    assert person.post('/api/study/me/finish-cases').status_code == 409
    with study.db() as c:
        order = {row['rank']: row['position'] for row in c.execute('SELECT rank, position FROM study_entries WHERE session_id=%s', (session_id,)).fetchall()}
    truth = {position: (reference, ai) for position, reference, ai, _ in ITEMS}
    for rank, position in order.items():
        reference, ai = truth[position]
        # Participant accepts every suggestion except for position 1, where the wrong suggestion is detected.
        final = reference if position == 1 else ai
        result = person.post(f'/api/study/me/cases/{rank}/decision', json={'final_code': final, 'certainty': 5 if final == reference else 2, 'rationale': 'Quellen geprüft'})
        assert result.json()['decision'] == ('corrected' if final != ai else 'confirmed')
    first_rank = next(rank for rank, position in order.items() if position == 0)
    person.post(f'/api/study/me/cases/{first_rank}/decision', json={'final_code': 'G', 'certainty': 4, 'rationale': 'Nochmals geprüft'})
    assert person.post('/api/study/me/finish-cases').status_code == 200
    assert person.post('/api/study/me/cases/1/decision', json={'final_code': 'A', 'certainty': 1, 'rationale': 'x'}).status_code == 409
    assert person.get('/api/study/me').json()['status'] == 'questionnaire'

    # Questionnaire: raw NASA-TLX in steps of five and one usability question.
    tlx = {'mental': 60, 'physical': 10, 'temporal': 40, 'performance': 30, 'effort': 50, 'frustration': 20}
    assert person.post('/api/study/me/questionnaire', json={'tlx': {**tlx, 'mental': 62}, 'usability': 4}).status_code == 422
    assert person.post('/api/study/me/questionnaire', json={'tlx': tlx, 'usability': 4, 'comment': 'Gut'}).status_code == 200
    assert person.post('/api/study/me/questionnaire', json={'tlx': tlx, 'usability': 4}).status_code == 409
    assert person.get('/api/study/me').json()['status'] == 'completed'
    assert person.post('/api/study/access', json={'code': code}).status_code == 410

    # Dashboard: pilot runs are excluded unless requested.
    evaluation = admin.get('/api/study/admin/evaluation').json()
    metrics = evaluation['metrics']
    assert metrics['sessions'] == 1 and metrics['decisions'] == 4
    assert metrics['outcomes'] == {'confirmed': 2, 'harmed': 0, 'detected': 1, 'adopted': 1, 'other_wrong': 0}
    assert metrics['groups']['ai_wrong']['human_correct'] == 1 and metrics['groups']['final_correct']['certainty_normalized']['mean'] == pytest.approx(11 / 12)
    assert metrics['groups']['final_wrong']['certainty_normalized']['mean'] == 0.25
    assert metrics['questionnaire']['raw_tlx']['mean'] == pytest.approx(35)
    assert admin.get('/api/study/admin/evaluation', params={'include_pilot': True}).json()['metrics']['sessions'] == 1  # pilot not finished
    detail = admin.get(f'/api/study/admin/sessions/{session_id}').json()
    assert detail['session']['accuracy'] == 0.75 and detail['questionnaire']['usability'] == 4
    assert next(e for e in detail['entries'] if e['position'] == 0)['changes'] == 1
    assert [e['action'] for e in detail['events']][:3] == ['created', 'access', 'start']
    entries_csv = admin.get('/api/study/admin/export', params={'kind': 'entries'})
    assert entries_csv.headers['content-type'].startswith('text/csv') and 'participant_code' in entries_csv.text and entries_csv.text.count('\n') == 5
    assert 'tlx_mental' in admin.get('/api/study/admin/export', params={'kind': 'questionnaires'}).text
    assert len(admin.get('/api/study/admin/export', params={'all_sessions': True}).json()['sessions']) == 2

    # Aborting invalidates the participant's access; deleting removes all data of a test run.
    person2 = TestClient(main.app, headers=ORIGIN)
    regenerated = admin.post(f"/api/study/admin/sessions/{pilot['id']}/code").json()['access_code']
    assert person2.post('/api/study/access', json={'code': pilot['access_code']}).status_code == 401
    assert person2.post('/api/study/access', json={'code': regenerated}).status_code == 200
    assert admin.post(f"/api/study/admin/sessions/{pilot['id']}/abort").status_code == 200
    assert person2.get('/api/study/me').status_code == 401
    assert person2.post('/api/study/access', json={'code': regenerated}).status_code == 410
    assert admin.delete(f"/api/study/admin/sessions/{pilot['id']}").status_code == 200
    assert len(admin.get('/api/study/admin/sessions').json()['items']) == 1

    # A classification run used by the study cannot be deleted.
    deleted = admin.delete(f'/api/classification/runs/{study.run_id}')
    assert deleted.status_code == 409 and 'Nutzerstudie' in deleted.json()['detail']


def test_study_tables_are_created_on_first_use():
    url = os.environ.get('TEST_DATABASE_URL')
    if not url:
        pytest.skip('TEST_DATABASE_URL fehlt')
    import study_api
    url = url.replace('-pooler.', '.')
    schema = 'study_schema_' + uuid.uuid4().hex
    with psycopg.connect(url, autocommit=True) as c:
        c.execute(f'CREATE SCHEMA {schema}')
    try:
        with psycopg.connect(url, options=f'-c search_path={schema}', row_factory=dict_row) as c:
            c.execute(Path(study_api.__file__).with_name('schema.sql').read_text().split(study_api.SCHEMA_MARKER)[0])
            assert c.execute("SELECT to_regclass('study_sessions') AS t").fetchone()['t'] is None
            study_api._schema_ready = False
            study_api.ensure_schema(c)
            study_api.ensure_schema(c)
            assert c.execute("SELECT to_regclass('study_sessions') AS t").fetchone()['t'] is not None
            assert c.execute("SELECT count(*) AS n FROM study_case_sets").fetchone()['n'] == 0
    finally:
        with psycopg.connect(url, autocommit=True) as c:
            c.execute(f'DROP SCHEMA {schema} CASCADE')
