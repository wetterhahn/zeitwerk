# Zeitwerk

Selbst gehostete Wochenzeiterfassung mit Import der bestehenden Excel-Wochenmappe. Die Anwendung besteht aus einem einzelnen Docker-Container und speichert ihre Daten zentral in einem Docker-Volume.

Im Repository sind keine Mitarbeiter, Namen, Personalnummern, Auftragsnummern oder Zeitdaten enthalten. Diese Daten entstehen erst durch einen Import in der laufenden Instanz.

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

Falls Port 8080 bereits belegt ist, kann in `docker-compose.yml` beispielsweise `8090:3000` verwendet werden.

## Excel-Datei importieren

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

## Sicherheit

Zeitwerk enthält derzeit keine eigene Anmeldung. Die Anwendung sollte deshalb nur im internen Netz veröffentlicht oder hinter einem Reverse Proxy mit Zugangsschutz betrieben werden. Der Container läuft als unprivilegierter Benutzer und besitzt einen Healthcheck.

## Lokale Entwicklung

```bash
corepack enable
pnpm install
pnpm test
pnpm start
```

Danach ist die Anwendung unter `http://localhost:3000` erreichbar.
