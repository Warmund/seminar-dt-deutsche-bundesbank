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

Unter „Profil“ lässt sich das eigene Passwort mit dem aktuellen Passwort ändern (mindestens 12 Zeichen). Andere Sitzungen werden dabei abgemeldet. Im Admin-Panel können Administratoren Nutzer anlegen, Administratorrechte vergeben oder entziehen und Konten sperren oder wieder aktivieren. Das eigene Administratorkonto kann dort nicht gesperrt oder herabgestuft werden. Gesperrte Konten verlieren ihre bestehenden Sitzungen.

## MONETA-Import

Auf der Seite **Moneta** die Datei `MONETA_extended.json` auswählen. Optional gleichzeitig alle PNG-Dateien aus `images/osm` und `images/satellite` in den beiden getrennten Bildfeldern markieren. Bildnamen müssen dem Moneta-Export entsprechen, zum Beispiel `way_123.png`. Bilder lassen sich später separat ergänzen. Pro Bild bzw. einzelnem JSON-Datenpunkt sind 3 MB erlaubt, die JSON-Datei insgesamt bis 100 MB. Die Oberfläche teilt den Import in einzelne Anfragen auf.

PostgreSQL speichert die Datensätze in `moneta_records`: OSM-Typ und ID bilden gemeinsam den Schlüssel, Name und NACE-Abschnitt sind separat suchbar, alle Originalfelder und Quellen bleiben in JSONB erhalten. `moneta_images` enthält die Bildzuordnungen und privaten Objektschlüssel, getrennt nach `osm` und `satellite`. PNG-Dateien liegen im Object Storage; alte BYTEA-Einträge bleiben während einer Migration lesbar. Alle angemeldeten Projektbenutzer sehen dieselben Daten. Wiederholte Imports aktualisieren vorhandene Datensätze und ausgewählte Bilder; nicht erneut hochgeladene Bilder bleiben erhalten. Es werden keine fremden URLs abgerufen und keine KI-Aufrufe ausgeführt.

Jede einzelne Anfrage wird unabhängig gespeichert. Bei einem Fehler bleibt der bereits erfolgreiche Teil erhalten; die Oberfläche zeigt die Anzahl an. Derselbe Import kann wiederholt werden. Vorhandene Installationen müssen `backend/schema.sql` einmal ausführen, um die neuen Tabellen anzulegen. Die Bilder werden im privaten Neon Object Storage gespeichert.

Die Übersicht bietet Suche, Seitenwechsel, Bildstatus und Details mit dem vollständigen Quelldatensatz sowie den hochgeladenen Bildern. Die importierte `category` ist eine NACE-Referenzklasse, keine neue Modellvorhersage.

### Umstellung auf privaten Object Storage

Die vorbereitete Object-Storage-Anbindung benötigt im Backend `AWS_ENDPOINT_URL_S3`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` und `MONETA_IMAGE_BUCKET`. Der Bucket muss privat sein; Zugangsdaten dürfen nicht ins Frontend. Neue Bilder werden als unveränderliche Objekte gespeichert. Die Datenbank hält nur den Objektschlüssel; der authentifizierte Bild-Endpunkt erzeugt einen fünf Minuten gültigen Download-Link. Alte BYTEA-Bilder bleiben während der Umstellung weiterhin abrufbar.

Reihenfolge: privaten Bucket und Zugangsdaten einrichten, `schema.sql` anwenden, Backend mit Storage-Konfiguration veröffentlichen, dann `python migrate_images.py` mit derselben Datenbank- und Storage-Konfiguration ausführen. Die Migration überträgt jeweils ein bestehendes Bild, lädt es zur SHA-256-Prüfung zurück und ersetzt erst nach erfolgreicher Prüfung die BYTEA-Daten durch den Objektschlüssel. Fortschritt wird pro Bild gespeichert; ein abgebrochener Lauf kann erneut gestartet werden. Fehlschläge lassen die ursprünglichen Daten erhalten. Neue Uploads ohne Storage-Konfiguration werden mit 503 abgewiesen. Nicht mehr verwendete Objekte nach Bildersetzungen werden vorerst nicht automatisch gelöscht.

Der Bildspeicher liegt im separaten Neon-Free-Projekt `moneta-images` (`lingering-lab-78352541`, Region Frankfurt), Branch `main` (`br-purple-bird-ba8fr0cb`), privater Bucket `moneta-images`. Die über Vercel verwaltete PostgreSQL-Datenbank bleibt im bisherigen Projekt. Beide Dienste werden ausschließlich serverseitig verbunden.

### OpenAI-Klassifizierung

Lokaler Schlüssel in `.env` im Projekt-Hauptordner (siehe `.env.example`):
`OPENAI_API_KEY` und optional `OPENAI_MODEL` (Standard: `gpt-6-luna`).
Die Datei ist von Git ausgeschlossen und wird nur vom Backend geladen.
Auf Vercel dieselben Variablen im **Backend-Projekt** setzen, den Key als Secret;
anschließend das Backend neu deployen. Niemals `VITE_` für den Key verwenden.

Auf „Klassifizierung“ Unternehmen und Quellen auswählen und kostenpflichtig starten.
Pro Unternehmen erfolgt ein Responses-Aufruf ohne automatische Wiederholung,
mit höchstens 24.000 Zeichen aus einer begrenzten Auswahl an OSM-Tags und
angereicherten Texten sowie optional den vorhandenen Karten-/Satellitenbildern.
Referenzklasse und Importhistorie werden nicht an das Modell übermittelt.
Die Ausgabe verwendet das NACE-Abschnittsschema A–U des MONETA-Repositories
oder `UNK` bei fehlenden Belegen. Dies ist keine detaillierte WZ-Klassifikation.
`nace_sections.json` übernimmt die Abschnittsbezeichnungen aus MONETA (`constants.py`, MIT).
Begründung und Unsicherheiten sind Modellangaben, keine kalibrierte Konfidenz.
Ergebnisse bleiben aktuell im Seitenzustand und werden nicht dauerhaft gespeichert.
Beim ersten Fehler stoppt der Durchlauf; bereits erhaltene Ergebnisse bleiben sichtbar.
„Stoppen“ beendet den Durchlauf nach dem aktuellen API-Aufruf.
Ein serverseitiges Limit erlaubt 100 Versuche pro Benutzer und Stunde.
OpenAI wird mit `store=False` aufgerufen; dies ersetzt keine Prüfung der
Datenaufbewahrungseinstellungen des OpenAI-Projekts.

### Gespeicherte Klassifizierungsläufe

„Klassifizierung“ öffnet die eigenen Läufe mit getrennten Detailseiten. Unter
„Neuer Lauf“ werden Name, Quellen und bis zu 1.000 ausgewählte Unternehmen
festgehalten. Das Anlegen selbst löst keine OpenAI-Anfragen aus.
PostgreSQL speichert pro Lauf Modell-ID, vollständigen Prompt, Quellenoptionen
und je Unternehmen Name, Referenz, begrenzte Texte sowie unveränderliche
Object-Storage-Bildschlüssel als Momentaufnahme. Spätere Datenimporte ändern
diese Eingaben nicht. Referenz und bisherige Ergebnisse gehen nicht an das Modell.
Bildobjekte, auf die Läufe verweisen, müssen bei künftigen Bereinigungen erhalten bleiben.

Der Start verarbeitet offene Einträge nacheinander im geöffneten Browser.
Jedes Ergebnis inklusive Begründung, Unsicherheit, tatsächlicher Modell-ID,
Quellenstatus und Tokenverbrauch wird sofort separat gespeichert. Ein Lauf
ist nur für seinen Ersteller sichtbar. Beim Seitenwechsel stoppt die Schleife
nach dem aktuellen Aufruf; es gibt noch keinen Hintergrund-Worker.
Fertige Einträge werden beim Fortsetzen nicht erneut angefragt. Fehler und
über fünf Minuten unterbrochene Anfragen benötigen einen ausdrücklich bestätigten
Neuversuch, der erneut Kosten verursachen kann. Eine Sperre verhindert gleichzeitige
API-Aufrufe innerhalb desselben Laufs. Frühere, ausschließlich im Seitenzustand
vorhandene Ergebnisse können nicht nachträglich wiederhergestellt werden.

### MONETA-Verfahren

Neue Läufe bieten **Zero-Shot** (ein Modellaufruf pro Unternehmen) und
**Multi-Turn** (ein Hinweisaufruf je vorhandener Modalität, dann eine abschließende
textbasierte Klassifizierung aus Hinweisen und Name). Multi-Turn verwendet wie
MONETA alle verfügbaren Quellen: OSM, Satellit, Wikidata, Wikipedia, Website.
Fehlende Quellen werden ausgelassen. Zero-Shot erlaubt eine Quellenauswahl bis
hin zur reinen Namensbaseline. Originale MONETA-Prompts und NACE-Beschreibungen
sind unter MIT in `backend/moneta_prompts.json` übernommen, mit Lizenz in
`backend/LICENSE.moneta`. Simple enthält Titel/Codes, Extended ergänzt Beschreibungen,
Ein- und Ausschlüsse. Die gespeicherten Prompts dokumentieren den verwendeten Stand.

OpenAI-Anpassungen: strukturiertes Ergebnis mit deutschen Begründungen statt
MONETAs LLM_RESPONSE/EXPLANATION, Schutz vor Anweisungen aus Quelltexten,
maximal 6.000 Zeichen je Textquelle und Bilder mit `detail=low`.
Nicht angereicherte Links/QIDs/Wikipedia-Verweise werden als fehlender Text
behandelt und nicht online aufgelöst. OSM-Tags über den Namen hinaus werden in
neuen Läufen nicht als zusätzliche Features eingespeist. Diese Anpassungen und
das andere Modell verhindern eine exakte Reproduktion der lokalen Paper-Ergebnisse.

Jeder Hinweisaufruf wird unmittelbar mit Modell und Tokenverbrauch in PostgreSQL
gespeichert. Ein HTTP-Aufruf verarbeitet nur einen Hinweisschritt oder die finale
Klassifizierung, damit Serverless-Laufzeitgrenzen nicht über sechs Modellaufrufe
hinweg überschritten werden. Fortsetzen verwendet gespeicherte Hinweise wieder;
Hinweise werden nicht zwischen unabhängigen Läufen geteilt. Nach einem Fehler
wird nur der fehlgeschlagene Schritt ausdrücklich wiederholt. Der Schlussaufruf
sieht ausschließlich Hinweise und Name, keine Originaltexte, Bilder oder Referenz.
Die Ergebnisdetails zeigen Hinweise und getrennte Tokenzahlen für Hinweisanalysen
und Schlussklassifizierung. Das Stundenlimit zählt jeden einzelnen Modellaufruf.
Bestehende Läufe behalten ihr bisheriges Verfahren (`legacy`), Prompts und Eingaben.

### Auswahl nach Anzahl und Klassen

Neue Läufe wählen Datenpunkte über eine Gesamtanzahl (1–1.000) und einen
Mehrfachfilter für NACE-Abschnitte A–U. Die Oberfläche zeigt die aktuelle
Verfügbarkeit je Klasse. Die Anzahl gilt insgesamt, nicht je Klasse;
es erfolgt keine Quotierung oder Zufallsstichprobe. Das Backend wählt passende
Datensätze stabil nach OSM-Typ und numerischer OSM-ID. Bei zu wenigen Treffern
wird der Lauf nicht angelegt. Kriterien und konkrete Eingaben werden gemeinsam
im Lauf gespeichert. Klassenfilter werden nicht an das Modell übermittelt.
Die Bildverweise werden gebündelt gelesen und Einträge gesammelt geschrieben,
damit auch größere Auswahlen ohne einzelne Browseranfragen angelegt werden.

### Modellauswahl

Beim Anlegen eines Laufs kann zwischen `gpt-5-mini`, `gpt-6-luna`, `gpt-6.1-terra` und dem konfigurierten Jev-Modell
gewählt werden. Das Backend akzeptiert nur diese unterstützten IDs für neue Läufe
und speichert die Wahl im Lauf. Alle Hinweise und die Schlussklassifizierung
verwenden anschließend diese gespeicherte ID. Bestehende Läufe behalten ihr
Modell; `OPENAI_MODEL` ist nur noch der Standard für API-Anfragen ohne Auswahl.
Die Zugriffsmöglichkeit auf ein Modell hängt zusätzlich vom OpenAI-Projekt ab. OpenAI kündigt die Abschaltung von GPT-5 Mini für den 11. Dezember 2026 an.

### Jev über OpenCode

Zusätzlich in der lokalen `.env`: `OPENCODE_API_KEY` und
`OPENCODE_JEV_MODEL=jev-1.13` (alternativ `jev-1.13-free`). Auf Vercel beide
Variablen nur im Backend-Projekt setzen, den Key als Secret. Die Oberfläche
bietet das konfigurierte Jev-Modell neben den GPT-Modellen an.

Jev verwendet die OpenCode-System-One-API statt OpenAI Responses. Eine Choice-Frage
enthält bei neuen Läufen die 21 NACE-Abschnitte ohne UNK; Simple/Extended steuert die Beschreibung
der Kriterien. Die Konfidenz dient zur Auswahl manueller Prüffälle. Bereits angelegte
Läufe behalten ihre gespeicherte Auswahl einschließlich UNK. Name, ausgewählte Quelltexte und optionale Bilder sind der State.
Referenz und Klassenfilter werden nicht übermittelt. Bilder werden serverseitig
aus dem privaten Speicher gelesen und als PNG-Assets übertragen; diese Jev-Funktion
ist laut TypeSafe experimentell. Quelle und Format:
https://opencode.ai/docs/console/models/#jev und https://docs.typesafe.ai/images

Jev liefert keine freien Begründungen oder MONETA-Hinweise. Deshalb ist ausschließlich
das direkte Zero-Shot-Verfahren verfügbar, als Choice-Adaption des Klassifizierungsziels.
Es ist keine identische Reproduktion des generativen MONETA-Prompts.
Klassenwahrscheinlichkeiten und Konfidenz werden unverändert im Lauf gespeichert;
die Detailansicht zeigt die fünf höchsten Wahrscheinlichkeiten. Leere Begründungsfelder
werden nicht durch erfundene Texte gefüllt. Fehlertexte enthalten keine Provider-Rohantworten
oder Zugangsdaten, und es gibt keine automatischen Wiederholungen.

### Textaufbereitung für Jev

Neue Jev-Läufe bereiten Quelltexte vor dem 6.000-Zeichen-Limit auf (`jev-text-v1`).
Die Verarbeitung entfernt erkennbare eigenständige Navigations-/Consent-Texte,
normalisiert Leerzeichen und entfernt Wiederholungen. Tätigkeits- und
Produkt-/Dienstleistungsbeschreibungen werden anhand sprachlicher Merkmale
priorisiert; ausgewählte Passagen bleiben in ihrer ursprünglichen Reihenfolge.
Auch Passagen nach den ersten 6.000 Zeichen können dadurch aufgenommen werden.
Für Wikidata-JSON mit `label`/`claims` werden wirtschaftlich relevante Properties
vor anderen Claims aufgenommen. Es werden keine Inhalte generiert oder Webseiten
nachgeladen und keine zusätzlichen API-Aufrufe ausgelöst.

Dies ist eine heuristische Auswahl, kein vollständiger semantischer Extraktor:
Nicht erkannte Boilerplate kann erhalten bleiben und relevante Passagen können
weiterhin fehlen. Die Accuracy-Verbesserung muss separat gemessen werden.
Originaldaten und bestehende Lauf-Snapshots bleiben unverändert. GPT-Läufe nutzen
weiterhin ihre bisherige Textaufbereitung. Neue Jev-Snapshots speichern die
Verarbeitungsversion und die tatsächlich ausgewählten Texte.

### Konfidenz und Analyse

Neue OpenAI-Klassifizierungsläufe fragen eine verbalisierte Selbsteinschätzung zwischen 0 und 1 ab und speichern sie mit dem Ergebnis. Es handelt sich nicht um eine gemessene Wahrscheinlichkeit; ihre Kalibrierung muss anhand von Referenzdaten überprüft werden. Ältere Läufe bleiben unverändert und besitzen gegebenenfalls keinen numerischen Wert.

Unter „Analyse“ können eigene gespeicherte Läufe oder eine JSON-Datei mit `items` beziehungsweise einer Liste geladen werden. Ein einfaches Eintragsformat ist `{"reference":"G","prediction":"G","confidence":0.8,"confidence_method":"verbalized"}`. Das ursprüngliche MONETA-Format mit `category` und `llm_response` wird ebenfalls gelesen. Ungültige oder unvollständige Einträge werden ausgelassen; fehlende oder ungültige Konfidenzwerte werden nicht ersetzt. Unterschiedliche Konfidenzmethoden müssen getrennt analysiert werden.

Die Seite zeigt Accuracy, ECE über zehn gleich breite Intervalle und AUROC zur Unterscheidung richtiger und falscher Vorhersagen. Für die Schwellenwertanalyse werden Datenpunkt-IDs reproduzierbar ungefähr 70:30 aufgeteilt; ohne ID wird die Reihenfolge verwendet. Fehlende Konfidenz und UNK-Vorhersagen zählen immer zur manuellen Prüfung. Ein Kalibrierungsdiagramm stellt mittlere Konfidenz und Trefferquote gegenüber; die Verwechslungsmatrix zeigt Referenzklassen und Vorhersagen als Fallzahlen. Die angezeigte automatische Accuracy bewertet nur die automatisch angenommenen Fälle; tatsächliche Ergebnisse menschlicher Prüfungen sind nicht enthalten. Die Überprüfungsmenge sollte erst nach Festlegung des Schwellenwerts betrachtet werden; wiederholtes Anpassen anhand dieser Menge verzerrt die Bewertung. Die Nutzerstudie mit menschlichen Entscheidungen, Bearbeitungszeit und Rückfragen ist noch nicht angebunden.

### Perplexity Decider über Vercel AI Gateway

`VERCEL_API_KEY` in der lokalen `.env` und als Secret im Vercel-Backend-Projekt setzen. `perplexity/pplx-decider-v1.2` wird über die TypeSafe-kompatible AI-Gateway-Schnittstelle als Zero-Shot-Klassifikator mit denselben NACE-Kriterien wie Jev aufgerufen. Bilder werden als PNG-Daten eingebettet und auf höchstens 1400 × 1400 Pixel verkleinert. Der vom Anbieter berechnete `confidence`-Wert beschreibt die Konzentration der Klassenverteilung; er ist keine direkte Trefferwahrscheinlichkeit. Die Rohwahrscheinlichkeiten und Konfidenzmethode werden gespeichert.
