import os
import secrets
from pathlib import Path

import psycopg
import pytest
from fastapi.testclient import TestClient

from main import app
from auth import passwords


@pytest.fixture
def accounts(monkeypatch):
    url = os.environ.get('TEST_DATABASE_URL')
    if not url:
        pytest.skip('TEST_DATABASE_URL fehlt')
    monkeypatch.setenv('DATABASE_URL', url)
    prefix = 'management_' + secrets.token_hex(6)
    with psycopg.connect(url) as connection:
        connection.execute(Path(__file__).with_name('schema.sql').read_text())
        for name, admin in [('admin', True), ('member', False)]:
            connection.execute('INSERT INTO app_users (username, password_hash, is_admin) VALUES (%s, %s, %s)',
                               (prefix + name, passwords.hash('original-test-password'), admin))
    try:
        yield prefix
    finally:
        with psycopg.connect(url) as connection:
            connection.execute('DELETE FROM app_users WHERE username LIKE %s', (prefix + '%',))
            connection.execute("DELETE FROM login_attempts WHERE client = 'testclient'")


def login(client, username, password='original-test-password'):
    response = client.post('/api/auth/login', json={'username': username, 'password': password})
    assert response.status_code == 200, response.text


def test_admin_permissions_and_account_lifecycle(accounts):
    with TestClient(app, headers={'Origin': 'http://localhost:5173'}) as admin, TestClient(app, headers={'Origin': 'http://localhost:5173'}) as member:
        assert member.get('/api/admin/users').status_code == 401
        login(admin, accounts + 'admin')
        login(member, accounts + 'member')
        assert member.get('/api/admin/users').status_code == 403
        assert member.post('/api/admin/users', json={'username': accounts + 'forbidden', 'password': 'new-test-password'}).status_code == 403
        created = admin.post('/api/admin/users', json={'username': accounts + 'new', 'password': 'new-test-password'})
        assert created.status_code == 201
        assert admin.post('/api/admin/users', json={'username': accounts + 'new', 'password': 'new-test-password'}).status_code == 409
        users = admin.get('/api/admin/users').json()
        own = next(u for u in users if u['username'] == accounts + 'admin')
        target = next(u for u in users if u['username'] == accounts + 'member')
        assert 'password_hash' not in target
        path = f"/api/admin/users/{target['id']}"
        assert member.patch(path, json={'is_admin': True, 'active': True}).status_code == 403
        assert admin.patch(path, headers={'Origin': 'https://evil.example'}, json={'is_admin': True, 'active': True}).status_code == 403
        assert admin.patch(f"/api/admin/users/{own['id']}", json={'is_admin': False, 'active': True}).status_code == 400
        assert admin.patch(f"/api/admin/users/{own['id']}", json={'is_admin': True, 'active': False}).status_code == 400
        assert admin.patch(path, json={'is_admin': True, 'active': True}).status_code == 200
        assert member.get('/api/auth/me').json()['is_admin'] is True
        assert member.get('/api/admin/users').status_code == 200
        assert admin.patch(path, json={'is_admin': False, 'active': True}).status_code == 200
        assert member.get('/api/admin/users').status_code == 403
        assert admin.patch(path, json={'is_admin': False, 'active': False}).status_code == 200
        assert member.get('/api/auth/me').status_code == 401
        assert member.post('/api/auth/login', json={'username': accounts + 'member', 'password': 'original-test-password'}).status_code == 401
        assert admin.patch(path, json={'is_admin': False, 'active': True}).status_code == 200
        login(member, accounts + 'member')
        assert admin.patch('/api/admin/users/0', json={'is_admin': False, 'active': True}).status_code == 404


def test_password_change_verifies_current_password_and_revokes_other_sessions(accounts):
    with TestClient(app, headers={'Origin': 'http://localhost:5173'}) as client, TestClient(app, headers={'Origin': 'http://localhost:5173'}) as other:
        payload = {'current_password': 'original-test-password', 'new_password': 'replacement-test-password'}
        assert client.post('/api/auth/password', json=payload).status_code == 401
        login(client, accounts + 'member')
        login(other, accounts + 'member')
        assert client.post('/api/auth/password', headers={'Origin': 'https://evil.example'}, json=payload).status_code == 403
        assert client.post('/api/auth/password', json={**payload, 'current_password': 'incorrect'}).status_code == 400
        assert client.post('/api/auth/password', json={**payload, 'new_password': 'short'}).status_code == 422
        assert client.post('/api/auth/password', json=payload).status_code == 200
        assert client.get('/api/auth/me').status_code == 200
        assert other.get('/api/auth/me').status_code == 401
        assert other.post('/api/auth/login', json={'username': accounts + 'member', 'password': 'original-test-password'}).status_code == 401
        login(other, accounts + 'member', 'replacement-test-password')
