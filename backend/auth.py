import hashlib
import os
import secrets

import psycopg

from fastapi import Depends, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field
from pwdlib import PasswordHash

from main import Connection, app

passwords = PasswordHash.recommended()
DUMMY_HASH = passwords.hash('invalid-password-for-timing')
COOKIE = 'wz_session'


def origin_check(request: Request):
    origin = os.environ.get('APP_ORIGIN', 'http://localhost:5173')
    if request.headers.get('origin') != origin:
        raise HTTPException(status_code=403, detail='Ungültiger Ursprung')


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def current_user(request: Request, connection: Connection):
    token = request.cookies.get(COOKIE, '')
    if len(token) > 128:
        raise HTTPException(status_code=401, detail='Bitte anmelden')
    user = connection.execute(
        'SELECT u.id, u.username, u.is_admin FROM auth_sessions s JOIN app_users u ON u.id = s.user_id '
        'WHERE s.token_hash = %s AND s.expires_at > now() AND u.active', (token_hash(token),)
    ).fetchone()
    if not user:
        raise HTTPException(status_code=401, detail='Bitte anmelden')
    return user


class Login(BaseModel):
    model_config = ConfigDict(extra='forbid')
    username: str = Field(min_length=1, max_length=150)
    password: str = Field(min_length=1, max_length=1024)


@app.post('/api/auth/login', dependencies=[Depends(origin_check)])
def login(data: Login, request: Request, response: Response, connection: Connection):
    # The app is intended to run behind a trusted proxy; never trust forwarded headers here.
    client = request.client.host if request.client else 'unknown'
    attempt = connection.execute(
        "INSERT INTO login_attempts (client, attempts, expires_at) VALUES (%s, 1, now() + interval '15 minutes') "
        "ON CONFLICT (client) DO UPDATE SET attempts = CASE WHEN login_attempts.expires_at <= now() THEN 1 ELSE login_attempts.attempts + 1 END, "
        "expires_at = CASE WHEN login_attempts.expires_at <= now() THEN now() + interval '15 minutes' ELSE login_attempts.expires_at END RETURNING attempts", (client,)
    ).fetchone()
    connection.commit()
    if attempt['attempts'] > 10:
        raise HTTPException(status_code=429, detail='Zu viele Anmeldeversuche. Bitte später erneut versuchen.')
    user = connection.execute('SELECT * FROM app_users WHERE username = %s', (data.username,)).fetchone()
    valid = passwords.verify(data.password, user['password_hash'] if user else DUMMY_HASH)
    if not user or not valid or not user['active']:
        raise HTTPException(status_code=401, detail='Benutzername oder Passwort ist falsch')
    connection.execute('DELETE FROM login_attempts WHERE client = %s', (client,))
    old = request.cookies.get(COOKIE, '')
    if len(old) <= 128:
        connection.execute('DELETE FROM auth_sessions WHERE token_hash = %s', (token_hash(old),))
    connection.execute('DELETE FROM auth_sessions WHERE expires_at <= now()')
    token = secrets.token_urlsafe(32)
    connection.execute("INSERT INTO auth_sessions (token_hash, user_id, expires_at) VALUES (%s, %s, now() + interval '8 hours')", (token_hash(token), user['id']))
    response.set_cookie(COOKIE, token, max_age=28800, httponly=True, secure=os.environ.get('COOKIE_SECURE', 'false').lower() == 'true', samesite='strict', path='/')
    return {'username': user['username'], 'is_admin': user['is_admin']}


@app.get('/api/auth/me')
def me(user=Depends(current_user)):
    return {'username': user['username'], 'is_admin': user['is_admin']}


@app.post('/api/auth/logout', dependencies=[Depends(origin_check)])
def logout(request: Request, response: Response, connection: Connection, user=Depends(current_user)):
    connection.execute('DELETE FROM auth_sessions WHERE token_hash = %s', (token_hash(request.cookies[COOKIE]),))
    response.delete_cookie(COOKIE, path='/', httponly=True, samesite='strict', secure=os.environ.get('COOKIE_SECURE', 'false').lower() == 'true')
    return {'ok': True}


def admin_user(user=Depends(current_user)):
    if not user['is_admin']:
        raise HTTPException(status_code=403, detail='Administratorzugriff erforderlich')
    return user


class NewUser(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=False)
    username: str = Field(min_length=1, max_length=150, pattern=r'^\S+$')
    password: str = Field(min_length=12, max_length=1024)


@app.post('/api/admin/users', status_code=201, dependencies=[Depends(origin_check), Depends(admin_user)])
def create_user(data: NewUser, connection: Connection):
    try:
        user = connection.execute(
            'INSERT INTO app_users (username, password_hash) VALUES (%s, %s) RETURNING username',
            (data.username, passwords.hash(data.password)),
        ).fetchone()
    except psycopg.errors.UniqueViolation as exc:
        raise HTTPException(status_code=409, detail='Dieser Benutzername ist bereits vergeben') from exc
    return {'username': user['username']}
