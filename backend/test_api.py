import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from main import app, database
from auth import current_user


def test_missing_database_configuration(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    with TestClient(app) as client:
        assert client.get("/api/health").status_code == 503


def test_rejects_invalid_case():
    app.dependency_overrides[database] = lambda: None
    app.dependency_overrides[current_user] = lambda: {"id": 1, "username": "test"}
    try:
        with TestClient(app) as client:
            response = client.post("/api/cases", headers={"Origin": "http://localhost:5173"}, json={
                "company_name": "Unternehmen", "predicted_code": "A", "confidence": 1.2
            })
            assert response.status_code == 422
    finally:
        app.dependency_overrides.clear()


@pytest.mark.skipif(not os.environ.get("TEST_DATABASE_URL"), reason="TEST_DATABASE_URL fehlt")
def test_case_and_decision_persist(monkeypatch):
    import psycopg

    url = os.environ["TEST_DATABASE_URL"]
    monkeypatch.setenv("DATABASE_URL", url)
    with psycopg.connect(url) as connection:
        connection.execute(Path(__file__).with_name("schema.sql").read_text(encoding="utf-8"))
    app.dependency_overrides[current_user] = lambda: {"id": 1, "username": "test"}
    with TestClient(app, headers={"Origin": "http://localhost:5173"}) as client:
        assert client.get("/api/health").json() == {"status": "ok"}
        case = client.post("/api/cases", headers={"Origin": "http://localhost:5173"}, json={
            "company_name": "Testunternehmen", "predicted_code": "A", "confidence": 0.8
        })
        assert case.status_code == 201
        case_id = case.json()["id"]
        try:
            decision = client.post(f"/api/cases/{case_id}/decisions", json={
                "reviewer": "Testperson", "decision": "A"
            })
            assert decision.status_code == 201
            assert client.get(f"/api/cases/{case_id}/decisions").json()[0]["decision"] == "A"
            assert any(item["id"] == case_id for item in client.get("/api/cases").json())
            assert client.post("/api/cases/0/decisions", json={
                "reviewer": "Testperson", "decision": "A"
            }).status_code == 404
        finally:
            with psycopg.connect(url) as connection:
                connection.execute("DELETE FROM decisions WHERE case_id = %s", (case_id,))
                connection.execute("DELETE FROM cases WHERE id = %s", (case_id,))

    app.dependency_overrides.clear()


def test_origin_check_blocks_cross_site_requests():
    with TestClient(app) as client:
        response = client.post('/api/auth/login', headers={'Origin': 'https://evil.example'}, json={'username': 'test', 'password': 'wrong'})
        assert response.status_code == 403


@pytest.mark.skipif(not os.environ.get('TEST_DATABASE_URL'), reason='TEST_DATABASE_URL fehlt')
def test_authentication_lifecycle(monkeypatch):
    import psycopg
    import secrets
    from pwdlib import PasswordHash

    url = os.environ['TEST_DATABASE_URL']
    monkeypatch.setenv('DATABASE_URL', url)
    username = 'test_' + secrets.token_hex(8)
    password = 'sicheres-testpasswort'
    with psycopg.connect(url) as connection:
        connection.execute(Path(__file__).with_name('schema.sql').read_text(encoding='utf-8'))
        connection.execute('INSERT INTO app_users (username, password_hash) VALUES (%s, %s)', (username, PasswordHash.recommended().hash(password)))
    try:
        with TestClient(app, headers={'Origin': 'http://localhost:5173'}) as client:
            assert client.get('/api/cases').status_code == 401
            assert client.post('/api/auth/login', json={'username': username, 'password': 'wrong'}).status_code == 401
            response = client.post('/api/auth/login', json={'username': username, 'password': password})
            assert response.status_code == 200
            assert 'httponly' in response.headers['set-cookie'].lower()
            assert client.get('/api/auth/me').json()['username'] == username
            assert client.get('/api/cases').status_code == 200
            assert client.post('/api/auth/logout').status_code == 200
            assert client.get('/api/cases').status_code == 401
            for _ in range(10):
                client.post('/api/auth/login', json={'username': username, 'password': 'wrong'})
            assert client.post('/api/auth/login', json={'username': username, 'password': password}).status_code == 429
    finally:
        with psycopg.connect(url) as connection:
            connection.execute('DELETE FROM app_users WHERE username = %s', (username,))
            connection.execute("DELETE FROM login_attempts WHERE client = 'testclient'")
