# Moderationsanleitung Nutzerstudie

Diese Anleitung beschreibt den Ablauf einer Sitzung im Prototyp. Technische Details stehen im README unter „Nutzerstudie“.

## Vorbereitung (einmalig)

1. Unter **Nutzerstudie → Fallsets** ein Fallset anlegen: Klassifikationslauf wählen, Fälle frei auswählen oder mit „Vorschlagen“ einen Vorschlag erzeugen und anpassen, speichern.
2. Unter **Testläufe** mindestens einen **Probelauf** anlegen und komplett durchspielen (Code eingeben, Fälle bearbeiten, zurückspringen, eine Rückfrage stellen, Seite neu laden, Fälle abschließen, Fragebogen). Probeläufe lassen das Fallset bearbeitbar und sind in der Auswertung standardmäßig ausgeblendet.
3. Den Platzhaltertext der Begrüßung in `frontend/src/lib/study-i18n.ts` (`INTRO`) durch den abgestimmten Text ersetzen und die deutschen Fragebogenformulierungen prüfen.
4. Probeläufe nach dem Test löschen, wenn sie nicht mehr gebraucht werden.

## Pro Sitzung

1. Unter **Testläufe** entweder einen einzelnen Testlauf anlegen (Fallset, Teilnehmercode wird automatisch hochgezählt, Sprache) oder einmalig einen **Mehrfach-Code** für alle Sitzungen. Beim Mehrfach-Code erhält jede Person automatisch einen eigenen Testlauf (P01, P02 …). Code und Link `…/#study` lassen sich in der Übersicht jederzeit über „Code & Link“ anzeigen und kopieren.
2. Der teilnehmenden Person Link und Code geben. Sie gibt den Code ein, liest den Einführungstext und klickt „Test starten“. Ab dann läuft die Zeitmessung im Hintergrund; ein Timer ist nicht sichtbar.
3. Während der Sitzung zeigt die Liste der Testläufe den Fortschritt (aktualisiert sich alle 15 Sekunden).
4. Nach „Fälle abschließen“ folgt der Fragebogen. Danach erscheint „Vielen Dank“ und der Code ist verbraucht.

## Sonderfälle

- **Code vergessen:** In der Übersicht „Code & Link“ wählen. Für Testläufe aus der Zeit vor dieser Funktion gibt es nur „Neuer Code“.
- **Mehrfach-Code nach der Studie:** Deaktivieren, damit niemand versehentlich weitere Testläufe startet.
- **Browser geschlossen oder neu geladen:** Mit demselben Code erneut anmelden; der Stand bleibt erhalten.
- **Abbruch durch die teilnehmende Person:** „Abbrechen“ sperrt den Zugang sofort; bisherige Angaben bleiben gespeichert und erscheinen nicht in der Auswertung.
- **Widerruf der Einwilligung:** „Löschen“ entfernt alle Daten des Testlaufs endgültig.

## Nach den Sitzungen

Unter **Auswertung** die Kennzahlen ansehen und die CSV- bzw. JSON-Exporte für die Ausarbeitung herunterladen.
