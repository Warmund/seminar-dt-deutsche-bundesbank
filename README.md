# WZ-Validierung

## Lokal starten

Docker Desktop (mit Compose) installieren und starten, dann im Projektverzeichnis ausführen:

```sh
docker compose up --build
```

Das Dashboard ist unter http://localhost:5173 erreichbar, die interaktive API-Dokumentation unter http://localhost:8000/docs. PostgreSQL speichert Daten im Docker-Volume `postgres_data`. Das Schema wird beim ersten Anlegen des Datenbank-Volumes initialisiert; spätere Schemaänderungen benötigen eine Migration.

Das Backend bietet Endpunkte für Fälle und zugeordnete Prüfentscheidungen. Nach der Anmeldung zeigt die Oberfläche den shadcn-Block dashboard-01 mit gekennzeichneten Beispieldaten; diese sind nicht mit der Fälle-API verbunden und Änderungen werden nicht gespeichert. Die API schützt die Falldaten durch eine Anmeldung und ist ausschließlich für die lokale Entwicklung vorgesehen; die Docker-Ports sind an localhost gebunden. Für einen öffentlichen Betrieb müssen Zugangsschutz und sichere Datenbankzugänge eingerichtet werden.

## Entwicklung und Tests

Das Frontend kann separat mit `cd frontend`, `npm install` und `npm run dev` gestartet werden. Das Backend benötigt Python 3.13, die Abhängigkeiten aus `backend/requirements.txt`, eine PostgreSQL-Datenbank mit dem Schema aus `backend/schema.sql` und die Umgebungsvariable `DATABASE_URL`. Im Backend-Verzeichnis startet `uvicorn main:app --reload` den Server.

Für Backend-Tests `backend/requirements-test.txt` installieren und im Backend-Verzeichnis `pytest` ausführen. Mit `TEST_DATABASE_URL` auf eine separate PostgreSQL-Testdatenbank wird zusätzlich der Integrationstest ausgeführt; er legt das Schema bei Bedarf an und entfernt seine Testdaten.

## Anmeldung im Forschungsprototyp

Bei einem bereits vorhandenen Datenbank-Volume zunächst die neuen Tabellen anlegen (bestehende Daten bleiben erhalten):

```sh
docker compose exec -T db psql -U wz -d wz < backend/schema.sql
```

Nach `docker compose up --build -d` ein persönliches Konto interaktiv anlegen:

```sh
docker compose exec backend python create_user.py
```

Der Benutzername und ein Passwort mit mindestens 12 Zeichen werden abgefragt; das Passwort wird nicht in der Shell-History gespeichert. Danach unter http://localhost:5173 anmelden. Es gibt keine öffentliche Registrierung oder Passwort-Zurücksetzung. Beim lokalen Betrieb gilt `APP_ORIGIN=http://localhost:5173`; bei einer anderen Adresse muss der vollständige Browser-Origin im Backend passend gesetzt werden. Für HTTPS muss außerdem `COOKIE_SECURE=true` gesetzt sein. Die Compose-Konfiguration ist nur für lokale Entwicklung vorgesehen. Ein vorgeschalteter Proxy kann dazu führen, dass sich Benutzer das Limit für Anmeldeversuche teilen. Für öffentlichen Betrieb sind sichere Infrastruktur, Zugriffskontrollen und eine Sicherheitsprüfung erforderlich.
