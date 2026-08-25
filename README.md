# Zeitwerk

Selbst gehostete Wochenzeiterfassung mit Benutzerverwaltung und optionalem Import der bestehenden Excel-Wochenmappe. Die Anwendung besteht aus einem einzelnen Docker-Container und speichert ihre Daten zentral in einem Docker-Volume.

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

1. Unter **Benutzer** alle benötigten Benutzerkonten anlegen. Jedes Konto hat Vollzugriff.
2. Unter **Kalenderwochen** Jahr und Kalenderwoche auswählen.
3. Die Woche anlegen. Alle aktiven Benutzer werden automatisch übernommen.
4. Unter **Aufträge** die wöchentlich benötigten Aufträge mit verpflichtender Auftragsnummer erfassen.
5. Arbeitszeiten anschließend direkt unter **Erfassung** eintragen.

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

## Benutzer und Sicherheit

Zeitwerk besitzt eine eigene Anmeldung. Passwörter werden mit `scrypt` und einem individuellen Salt gehasht gespeichert; alle aktiven Konten haben bewusst dieselbe Berechtigungsstufe **Vollzugriff**. Sitzungen laufen nach zwölf Stunden ab und werden beim Neustart des Containers beendet. Für den Einsatz außerhalb des internen Netzes wird zusätzlich HTTPS über einen Reverse Proxy empfohlen. Der Container läuft als unprivilegierter Benutzer und besitzt einen Healthcheck.

## Lokale Entwicklung

```bash
corepack enable
pnpm install
pnpm test
pnpm start
```

Danach ist die Anwendung unter `http://localhost:3000` erreichbar.
