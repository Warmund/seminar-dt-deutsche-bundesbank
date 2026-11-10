"""Create a prototype user without putting its password in shell history."""
import getpass
import os
import sys

import psycopg
from pwdlib import PasswordHash

username = input('Benutzername: ').strip()
password = getpass.getpass('Passwort (mindestens 12 Zeichen): ')
if not username or len(username) > 150 or len(password) < 12 or len(password) > 1024:
    sys.exit('Ungültiger Benutzername oder ungültiges Passwort.')
if password != getpass.getpass('Passwort wiederholen: '):
    sys.exit('Die Passwörter stimmen nicht überein.')
with psycopg.connect(os.environ['DATABASE_URL']) as connection:
    connection.execute('INSERT INTO app_users (username, password_hash) VALUES (%s, %s)',
                       (username, PasswordHash.recommended().hash(password)))
print('Benutzerkonto angelegt.')
