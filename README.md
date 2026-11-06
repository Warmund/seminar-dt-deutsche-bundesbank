# WZ-Validierung

## Lokal starten

Docker Desktop (mit Compose) installieren und starten, dann im Projektverzeichnis ausführen:

```sh
docker compose up --build
```

Das Dashboard ist unter http://localhost:5173 erreichbar, die interaktive API-Dokumentation unter http://localhost:8000/docs. PostgreSQL speichert Daten im Docker-Volume `postgres_data`. Das Schema wird beim ersten Anlegen des Datenbank-Volumes initialisiert; spätere Schemaänderungen benötigen eine Migration.

Das Backend bietet Endpunkte für Fälle und zugeordnete Prüfentscheidungen. Die Oberfläche zeigt weiterhin den leeren Entwurf und liest noch keine Daten aus der API. Die API hat noch keine Anmeldung und ist ausschließlich für die lokale Entwicklung vorgesehen; die Docker-Ports sind an localhost gebunden. Für einen öffentlichen Betrieb müssen Zugangsschutz und sichere Datenbankzugänge eingerichtet werden.

## Entwicklung und Tests

Das Frontend kann separat mit `cd frontend`, `npm install` und `npm run dev` gestartet werden. Das Backend benötigt Python 3.13, die Abhängigkeiten aus `backend/requirements.txt`, eine PostgreSQL-Datenbank mit dem Schema aus `backend/schema.sql` und die Umgebungsvariable `DATABASE_URL`. Im Backend-Verzeichnis startet `uvicorn main:app --reload` den Server.

Für Backend-Tests `backend/requirements-test.txt` installieren und im Backend-Verzeichnis `pytest` ausführen. Mit `TEST_DATABASE_URL` auf eine separate PostgreSQL-Testdatenbank wird zusätzlich der Integrationstest ausgeführt; er legt das Schema bei Bedarf an und entfernt seine Testdaten.
