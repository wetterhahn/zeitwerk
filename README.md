# Zeitwerk

Aktuelle Version: **v1.3.0**

Selbst gehostete Wochenzeiterfassung mit gemeinsamer Mitarbeiterverwaltung, optionalen Anmeldekonten und optionalem Import der bestehenden Excel-Wochenmappe. Die Anwendung besteht aus einem einzelnen Docker-Container und speichert ihre Daten zentral in einem Docker-Volume.

Im Repository sind keine Mitarbeiter, Namen, Adressen, Personalnummern, Auftragsnummern oder Zeitdaten enthalten. Diese Daten entstehen ausschließlich in der laufenden Instanz.

## Installation mit Portainer

1. In Portainer **Stacks** öffnen und **Add stack** wählen.
2. Als Build-Methode **Repository** auswählen.
3. Repository-URL eintragen:

   ```text
   https://github.com/wetterhahn/zeitwerk.git
   ```

4. Als Compose-Pfad `docker-compose.yml` verwenden.
5. **Deploy the stack** auswählen.
6. Zeitwerk anschließend unter `http://SERVER-IP:8080` öffnen.

Falls Port 8080 bereits belegt ist, kann in `docker-compose.yml` beispielsweise `8090:3000` verwendet werden. Beim ersten Aufruf wird das erste Vollzugriff-Konto eingerichtet.

## Ohne Excel verwenden

1. Unter **Mitarbeiter** alle Personen für die Zeiterfassung anlegen. Standardmäßig wird kein Benutzername oder Passwort benötigt.
2. Nur bei Personen, die sich anmelden sollen, den Haken **Anmeldung mit Passwort** setzen. Jedes Konto hat Vollzugriff.
3. Unter **Kalenderwochen** Jahr und Kalenderwoche auswählen.
4. Die Woche anlegen. Alle aktiven Mitarbeiter werden automatisch übernommen.
5. Unter **Aufträge** Auftragsnummer, Bezeichnung, Beschreibung und die Mitarbeiterstunden für Montag bis Freitag erfassen.
6. Arbeitszeiten anschließend direkt unter **Erfassung** eintragen.

## Excel-Datei optional importieren

1. In Zeitwerk den Bereich **Excel-Import** öffnen.
2. Die ausgefüllte `.xlsx`-Wochenmappe auswählen oder in das Upload-Feld ziehen.
3. **Kalenderwoche importieren** wählen.

Der Import liest:

- Kalenderwoche und Datumsbereich,
- Personalnummern und Namen,
- Beginn, Ende und Pausen je Arbeitstag,
- Auftragsnummern, Bezeichnungen und Anforderer,
- die Stundenverteilung aus den einzelnen Auftragsblättern.

Wird dieselbe Kalenderwoche erneut importiert, ersetzt der neue Import den bisherigen Stand dieser Woche.

## Datenspeicherung und Sicherung

Die Daten liegen im benannten Docker-Volume `zeitwerk_data` unter `/app/data`. Die hochgeladene Excel-Datei selbst wird nicht gespeichert.

Für eine Sicherung muss das Volume `zeitwerk_data` regelmäßig gesichert werden. Beim Löschen des Stacks sollte das Volume nicht mit entfernt werden, wenn die Daten erhalten bleiben sollen.

## Aktualisierung

In Portainer den Stack öffnen, **Pull latest image** beziehungsweise **Re-pull image** aktivieren und den Stack erneut bereitstellen. Das Daten-Volume bleibt dabei erhalten.

## Mitarbeiter, Benutzer und Sicherheit

Mitarbeiter sind reine Stammdaten für die Zeiterfassung und benötigen standardmäßig kein Konto. Anmeldung, Benutzername und Passwort werden optional direkt am Mitarbeiter aktiviert; alle aktiven Konten haben bewusst dieselbe Berechtigungsstufe **Vollzugriff**. Der Container läuft als unprivilegierter Benutzer und besitzt einen Healthcheck.

Mitarbeiter können wieder gelöscht werden. Dabei werden Stammdaten und ein zugehöriges Anmeldekonto entfernt; bereits erfasste Wochen bleiben bewusst als Historie erhalten. Der eigene angemeldete Mitarbeiter ist gegen versehentliches Löschen geschützt.

Neue Passwörter benötigen mindestens 15 Zeichen und werden mit gehärteten `scrypt`-Parametern sowie individuellem Salt gespeichert. Ältere Hashes werden beim nächsten erfolgreichen Login automatisch aktualisiert. Fehlversuche werden gedrosselt, Sitzungen nach 30 Minuten Inaktivität oder spätestens acht Stunden beendet und bei Passwortänderung beziehungsweise Kontolöschung serverseitig widerrufen. Cookies verwenden `HttpOnly`, `SameSite=Strict` und unter HTTPS zusätzlich `Secure`. Für jeden Zugriff außerhalb eines vollständig vertrauenswürdigen internen Netzes ist HTTPS über einen Reverse Proxy erforderlich.

## Lokale Entwicklung

```bash
corepack enable
pnpm install
pnpm test
pnpm start
```

Danach ist die Anwendung unter `http://localhost:3000` erreichbar.

